#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime
import json
import math
import os
import re
from pathlib import Path
from typing import Any

REQUIRED_ROOT_DOCS = [
    'AGENTS.md',
    'CLAW.md',
    'HUMAN.md',
    'CLAWAS.md',
    'CURIOUS.md',
    'TOOLS.md',
    'pulses/AGENTS.md',
]
REQUIRED_WORKER_LOCAL_DOCS = [
    'AGENTS.md',
    'CLAW.md',
    'CURIOUS.md',
    'TOOLS.md',
    'pulses/AGENTS.md',
]
REQUIRED_WORKER_SHARED_DOCS = ['HUMAN.md', 'CLAWAS.md']
HYDRATION_ROOT_FILES = ['CLAW.md', 'HUMAN.md', 'CLAWAS.md', 'CURIOUS.md', 'TOOLS.md']
HYDRATION_WORKER_LOCAL_FILES = ['CLAW.md', 'CURIOUS.md', 'TOOLS.md']
VISUAL_HYDRATION_EXTENSIONS = ('.png', '.jpg', '.jpeg', '.webp', '.gif')
VISUAL_HYDRATION_MAX_DIMENSION = 1024
THINKING_LEVELS = {'off', 'minimal', 'low', 'medium', 'high', 'xhigh'}
REPORT_MODES = {'auto', 'explicit', 'off'}
WORKER_ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]*$')
PULSE_ID_RE = WORKER_ID_RE
FRONTMATTER_RE = re.compile(r'^---\n(.*?)\n---\n?', re.S)
EVERY_SCHEDULE_PATTERN = re.compile(
    r'^every\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hour|hours|d|day|days)$',
    re.I,
)
DAILY_SCHEDULE_PATTERN = re.compile(r'^daily\s+([01]?\d|2[0-3]):[0-5]\d$', re.I)
WEEKLY_SCHEDULE_PATTERN = re.compile(
    r'^weekly\s+(sun|mon|tue|wed|thu|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+([01]?\d|2[0-3]):[0-5]\d$',
    re.I,
)
AT_SCHEDULE_PATTERN = re.compile(r'^at\s+(.+)$', re.I)
QUIET_HOURS_PATTERN = re.compile(
    r'^(?:[01]?\d|2[0-3]):[0-5]\d\s*-\s*(?:[01]?\d|2[0-3]):[0-5]\d$'
)


def strip_jsonc(text: str) -> str:
    out: list[str] = []
    i = 0
    in_string = False
    quote = ''
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ''
        if in_string:
            out.append(ch)
            if ch == '\\' and i + 1 < len(text):
                i += 1
                out.append(text[i])
            elif ch == quote:
                in_string = False
            i += 1
            continue
        if ch in {'"', "'"}:
            # JSON itself only accepts double quotes, but keeping single quoted text intact
            # gives json.loads a clear syntax error instead of mangling the file.
            in_string = True
            quote = ch
            out.append(ch)
            i += 1
            continue
        if ch == '/' and nxt == '/':
            i += 2
            while i < len(text) and text[i] not in '\r\n':
                i += 1
            continue
        if ch == '/' and nxt == '*':
            i += 2
            while i + 1 < len(text) and not (text[i] == '*' and text[i + 1] == '/'):
                i += 1
            i += 2
            continue
        out.append(ch)
        i += 1
    stripped = ''.join(out)
    return re.sub(r',\s*([}\]])', r'\1', stripped)


def load_jsonc(path: Path) -> Any:
    return json.loads(strip_jsonc(path.read_text()))


def estimate_tokens(path: Path) -> int:
    try:
        return (len(path.read_text(errors='ignore')) + 3) // 4
    except OSError:
        return 0


def find_visual_hydration_files(home: Path) -> list[Path]:
    try:
        candidates = [
            path
            for path in home.iterdir()
            if path.is_file()
            and path.stem.upper() == 'CLAWA'
            and path.suffix.lower() in VISUAL_HYDRATION_EXTENSIONS
        ]
    except OSError:
        return []
    return sorted(
        candidates,
        key=lambda path: (
            VISUAL_HYDRATION_EXTENSIONS.index(path.suffix.lower()),
            path.name,
        ),
    )


def read_image_dimensions(path: Path) -> tuple[int, int] | None:
    try:
        data = path.read_bytes()
    except OSError:
        return None

    dimensions = (
        read_png_dimensions(data)
        or read_jpeg_dimensions(data)
        or read_gif_dimensions(data)
        or read_webp_dimensions(data)
    )
    if dimensions is None:
        return None
    width, height = dimensions
    if width <= 0 or height <= 0:
        return None
    return width, height


def read_png_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24 or data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        return None
    return int.from_bytes(data[16:20], 'big'), int.from_bytes(data[20:24], 'big')


def read_jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 4 or data[:3] != b'\xff\xd8\xff':
        return None
    offset = 2
    start_of_frame_markers = {
        0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
        0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
    }
    while offset + 3 < len(data):
        if data[offset] != 0xFF:
            offset += 1
            continue
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        if offset >= len(data):
            return None
        marker = data[offset]
        offset += 1
        if marker in {0x01, 0xD8, 0xD9}:
            continue
        if offset + 2 > len(data):
            return None
        segment_length = int.from_bytes(data[offset:offset + 2], 'big')
        if segment_length < 2 or offset + segment_length > len(data):
            return None
        if marker in start_of_frame_markers and segment_length >= 7:
            height = int.from_bytes(data[offset + 3:offset + 5], 'big')
            width = int.from_bytes(data[offset + 5:offset + 7], 'big')
            return width, height
        offset += segment_length
    return None


def read_gif_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 10 or data[:3] != b'GIF':
        return None
    return int.from_bytes(data[6:8], 'little'), int.from_bytes(data[8:10], 'little')


def read_webp_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 30 or data[:4] != b'RIFF' or data[8:12] != b'WEBP':
        return None
    chunk = data[12:16]
    if chunk == b'VP8X':
        width = 1 + int.from_bytes(data[24:27], 'little')
        height = 1 + int.from_bytes(data[27:30], 'little')
        return width, height
    if chunk == b'VP8 ' and data[23:26] == b'\x9d\x01\x2a':
        width = int.from_bytes(data[26:28], 'little') & 0x3FFF
        height = int.from_bytes(data[28:30], 'little') & 0x3FFF
        return width, height
    if chunk == b'VP8L' and data[20] == 0x2F:
        b1, b2, b3, b4 = data[21:25]
        width = 1 + (((b2 & 0x3F) << 8) | b1)
        height = 1 + (((b4 & 0x0F) << 10) | (b3 << 2) | (b2 >> 6))
        return width, height
    return None


def estimate_visual_tokens(width: int, height: int) -> tuple[int, int]:
    """Return a provider-agnostic range from common high-detail image schemes."""
    runtime_scale = min(1.0, VISUAL_HYDRATION_MAX_DIMENSION / max(width, height))
    width = max(1, round(width * runtime_scale))
    height = max(1, round(height * runtime_scale))
    patch_tokens = min(1536, math.ceil(width / 32) * math.ceil(height / 32))

    scale = min(1.0, 2048 / width, 2048 / height)
    tiled_width = width * scale
    tiled_height = height * scale
    shortest = min(tiled_width, tiled_height)
    if shortest > 768:
        scale = 768 / shortest
        tiled_width *= scale
        tiled_height *= scale
    tiles = math.ceil(tiled_width / 512) * math.ceil(tiled_height / 512)
    tile_tokens = 85 + 170 * tiles

    return min(tile_tokens, patch_tokens), max(tile_tokens, patch_tokens)


def parse_frontmatter(path: Path) -> dict[str, Any] | None:
    try:
        text = path.read_text()
    except OSError:
        return None
    m = FRONTMATTER_RE.match(text.replace('\r\n', '\n'))
    if not m:
        return None
    data: dict[str, Any] = {}
    for raw in m.group(1).splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if ':' not in line:
            continue
        key, value = line.split(':', 1)
        key = key.strip()
        value = value.strip().strip('"\'')
        if value == 'true':
            data[key] = True
        elif value == 'false':
            data[key] = False
        else:
            data[key] = value
    return data


def valid_schedule(value: str) -> bool:
    text = value.strip()
    if text.lower() == 'manual':
        return True
    every = EVERY_SCHEDULE_PATTERN.match(text)
    if every:
        return int(every.group(1)) > 0
    if DAILY_SCHEDULE_PATTERN.match(text) or WEEKLY_SCHEDULE_PATTERN.match(text):
        return True
    at = AT_SCHEDULE_PATTERN.match(text)
    if not at:
        return False
    try:
        datetime.fromisoformat(at.group(1).replace('Z', '+00:00'))
        return True
    except ValueError:
        return False


def valid_quiet_hours(value: str) -> bool:
    text = value.strip()
    if not QUIET_HOURS_PATTERN.match(text):
        return False
    start, end = [part.strip() for part in text.split('-', 1)]
    start_hour, start_minute = [int(part) for part in start.split(':', 1)]
    end_hour, end_minute = [int(part) for part in end.split(':', 1)]
    return start_hour * 60 + start_minute != end_hour * 60 + end_minute


class Doctor:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.ok = 0
        self.warns: list[str] = []
        self.fails: list[str] = []
        self.workers: list[dict[str, Any]] = []

    def ok_line(self, text: str) -> None:
        self.ok += 1
        print(f'OK   {text}')

    def warn(self, text: str) -> None:
        self.warns.append(text)
        print(f'WARN {text}')

    def fail(self, text: str) -> None:
        self.fails.append(text)
        print(f'FAIL {text}')

    def rel(self, path: Path) -> str:
        try:
            return str(path.relative_to(self.root))
        except ValueError:
            return str(path)

    def exists_file(self, relpath: str, *, fail: bool = True) -> bool:
        path = self.root / relpath
        if path.is_file() or path.is_symlink():
            self.ok_line(f'{relpath} exists')
            return True
        (self.fail if fail else self.warn)(f'missing {relpath}')
        return False

    def check_root_docs(self) -> None:
        print('\nCore files')
        for doc in REQUIRED_ROOT_DOCS:
            self.exists_file(doc)
        self.check_hydration_budget('main', self.root, HYDRATION_ROOT_FILES)

    def check_config(self) -> None:
        print('\nConfig')
        path = self.root / '.pi' / 'claw.jsonc'
        if not path.exists():
            self.fail('missing .pi/claw.jsonc')
            return
        try:
            config = load_jsonc(path)
        except Exception as exc:
            self.fail(f'.pi/claw.jsonc does not parse: {exc}')
            return
        if not isinstance(config, dict):
            self.fail('.pi/claw.jsonc must be an object')
            return
        self.ok_line('.pi/claw.jsonc parses')
        if not isinstance(config.get('bootstrapped'), bool):
            self.fail('bootstrapped must be a boolean')
        clawas = config.get('clawas')
        if not isinstance(clawas, dict):
            self.fail('clawas must be an object')
            return
        base_dir = clawas.get('baseDir')
        if not isinstance(base_dir, str) or not base_dir.strip():
            self.fail('clawas.baseDir must be a non-empty string')
            base_dir = 'clawas'
        else:
            self.ok_line('clawas.baseDir is set')
        if not isinstance(clawas.get('tmuxSession'), str) or not clawas.get('tmuxSession').strip():
            self.fail('clawas.tmuxSession must be a non-empty string')
        workers = clawas.get('workers')
        if not isinstance(workers, list):
            self.fail('clawas.workers must be an array')
            return
        self.ok_line(f'{len(workers)} worker entries configured')
        self.check_clawa_defaults(config.get('clawa'))
        self.check_workers(workers, str(base_dir))

    def check_clawa_defaults(self, value: Any) -> None:
        if not isinstance(value, dict):
            self.fail('clawa defaults object is missing')
            return
        for key in [
            'mainClawName',
            'clawasName',
            'workerSessionPrefix',
            'controlPlaneDir',
            'controlSocketDir',
        ]:
            if not isinstance(value.get(key), str) or not value.get(key).strip():
                self.fail(f'clawa.{key} must be a non-empty string')

    def check_workers(self, workers: list[Any], base_dir: str) -> None:
        seen: set[str] = set()
        base_abs = (self.root / base_dir).resolve()
        for index, raw in enumerate(workers):
            if not isinstance(raw, dict):
                self.fail(f'worker[{index}] must be an object')
                continue
            wid = raw.get('id')
            label = wid if isinstance(wid, str) else f'worker[{index}]'
            if not isinstance(wid, str) or not wid.strip():
                self.fail(f'worker[{index}].id must be a non-empty string')
                continue
            if wid in seen:
                self.fail(f'duplicate worker id: {wid}')
            seen.add(wid)
            if not WORKER_ID_RE.match(wid):
                self.warn(f'worker {wid}: id is not kebab-case')
            for key in ['title', 'cwd']:
                if not isinstance(raw.get(key), str) or not raw.get(key).strip():
                    self.fail(f'worker {label}: {key} must be a non-empty string')
            for key in ['enabled', 'autostart']:
                if not isinstance(raw.get(key), bool):
                    self.fail(f'worker {label}: {key} must be boolean')
            thinking = raw.get('thinking')
            if thinking is not None and thinking not in THINKING_LEVELS:
                self.fail(f'worker {label}: invalid thinking {thinking!r}')
            report = raw.get('reportMode')
            if report is not None and report not in REPORT_MODES:
                self.fail(f'worker {label}: invalid reportMode {report!r}')
            model = raw.get('model')
            if model is not None and not isinstance(model, str):
                self.fail(f'worker {label}: model must be a string when present')
            cwd = raw.get('cwd')
            if not isinstance(cwd, str):
                continue
            home = (self.root / cwd).resolve()
            try:
                home.relative_to(base_abs)
            except ValueError:
                self.fail(f'worker {label}: cwd is outside clawas.baseDir')
            if not home.exists():
                self.fail(f'worker {label}: cwd does not exist: {cwd}')
                continue
            self.workers.append({'id': wid, 'home': home, 'enabled': raw.get('enabled') is not False})
            if raw.get('enabled') is not False:
                self.check_worker_home(wid, home)
    def check_worker_home(self, wid: str, home: Path) -> None:
        print(f'\nWorker {wid}')
        for doc in REQUIRED_WORKER_LOCAL_DOCS:
            path = home / doc
            if path.is_file() or path.is_symlink():
                self.ok_line(f'{self.rel(path)} exists')
            else:
                self.fail(f'worker {wid}: missing {self.rel(path)}')
        for doc in REQUIRED_WORKER_SHARED_DOCS:
            path = home / doc
            root_path = self.root / doc
            if not (path.is_file() or path.is_symlink()):
                self.fail(f'worker {wid}: missing shared {self.rel(path)}')
            elif root_path.exists() and os.path.samefile(path, root_path):
                self.ok_line(f'worker {wid}: {doc} points to root shared file')
            else:
                self.warn(f'worker {wid}: {doc} is not the root shared file')
        self.check_hydration_budget(
            wid,
            home,
            HYDRATION_WORKER_LOCAL_FILES,
            shared=[self.root / 'HUMAN.md', self.root / 'CLAWAS.md'],
        )

    def check_hydration_budget(
        self,
        name: str,
        home: Path,
        files: list[str],
        shared: list[Path] | None = None,
    ) -> None:
        paths = [home / item for item in files]
        if shared:
            paths.extend(shared)
        text_total = sum(estimate_tokens(path) for path in paths if path.exists())

        visual_range: tuple[int, int] | None = None
        visual_paths = find_visual_hydration_files(home)
        if visual_paths:
            visual_path = visual_paths[0]
            dimensions = read_image_dimensions(visual_path)
            if dimensions is None:
                self.warn(f'{name} {visual_path.name} dimensions could not be read')
            else:
                width, height = dimensions
                visual_range = estimate_visual_tokens(width, height)
                low, high = visual_range
                self.ok_line(
                    f'{name} {visual_path.name} is {width}x{height} '
                    f'(~{low}-{high} visual tokens, provider-dependent)'
                )
            if len(visual_paths) > 1:
                extras = ', '.join(path.name for path in visual_paths[1:])
                self.warn(f'{name} has multiple CLAWA images; using {visual_path.name}, also found {extras}')

        if visual_range:
            low, high = visual_range
            low_total = text_total + low
            high_total = text_total + high
            message = (
                f'{name} hydration estimate ~{text_total} text + ~{low}-{high} visual '
                f'= ~{low_total}-{high_total} tokens'
            )
        else:
            high_total = text_total
            message = f'{name} hydration estimate ~{text_total} text tokens'

        if high_total > 20_000:
            self.warn(f'{message} (>20k)')
        else:
            self.ok_line(message)

    def check_agents_budgets(self) -> None:
        print('\nAGENTS budgets')
        for path in sorted(self.root.rglob('AGENTS.md')):
            if any(part in {'.git', 'node_modules'} for part in path.parts):
                continue
            rel = self.rel(path)
            tokens = estimate_tokens(path)
            if rel.endswith('pulses/AGENTS.md'):
                limit = 2_000
            else:
                limit = 3_000
            if tokens > limit:
                self.warn(f'{rel} is ~{tokens} tokens (limit ~{limit})')
            else:
                self.ok_line(f'{rel} is ~{tokens} tokens')

    def check_all_pulses(self) -> None:
        print('\nPulses')
        homes = [('main', self.root)] + [(w['id'], w['home']) for w in self.workers]
        seen: set[str] = set()
        for owner, home in homes:
            self.check_pulses_for_home(owner, home, seen)

    def check_pulses_for_home(self, owner: str, home: Path, seen: set[str]) -> None:
        pulses = home / 'pulses'
        if not pulses.exists():
            self.fail(f'{owner}: missing {self.rel(pulses)}')
            return
        if not (pulses / 'AGENTS.md').is_file():
            self.fail(f'{owner}: missing {self.rel(pulses / "AGENTS.md")}')
        for entry in sorted(pulses.iterdir()):
            if entry.name == 'AGENTS.md':
                continue
            if entry.is_file() and entry.suffix == '.md':
                self.fail(f'{owner}: loose pulse markdown is not allowed: {self.rel(entry)}')
                continue
            if not entry.is_dir():
                continue
            if not PULSE_ID_RE.match(entry.name):
                self.fail(f'{owner}: pulse folder must be kebab-case: {self.rel(entry)}')
                continue
            key = f'{owner}:{entry.name}'
            if key in seen:
                self.fail(f'duplicate pulse id: {key}')
            seen.add(key)
            agents = entry / 'AGENTS.md'
            definition = entry / 'PULSE.md'
            if not agents.is_file():
                self.fail(f'{owner}: missing {self.rel(agents)}')
            if not definition.is_file():
                self.fail(f'{owner}: missing {self.rel(definition)}')
                continue
            self.check_pulse_definition(owner, definition)

    def check_pulse_definition(self, owner: str, path: Path) -> None:
        data = parse_frontmatter(path)
        if data is None:
            self.fail(f'{owner}: {self.rel(path)} missing YAML frontmatter')
            return
        title = data.get('title')
        if not isinstance(title, str) or not title.strip():
            self.fail(f'{owner}: {self.rel(path)} missing title')
        enabled = data.get('enabled')
        if not isinstance(enabled, bool):
            self.fail(f'{owner}: {self.rel(path)} enabled must be true or false')
        schedule = data.get('schedule')
        if not isinstance(schedule, str) or not schedule.strip():
            self.fail(
                f'{owner}: {self.rel(path)} schedule is required; use schedule: manual for manual pulses'
            )
        elif not valid_schedule(schedule):
            self.fail(f'{owner}: {self.rel(path)} has invalid schedule: {schedule!r}')
        quiet_hours = data.get('quietHours')
        if quiet_hours is not None and (
            not isinstance(quiet_hours, str) or not valid_quiet_hours(quiet_hours)
        ):
            self.fail(
                f'{owner}: {self.rel(path)} quietHours must use distinct local times: HH:MM-HH:MM'
            )
        if (
            isinstance(schedule, str)
            and valid_schedule(schedule)
            and (quiet_hours is None or (isinstance(quiet_hours, str) and valid_quiet_hours(quiet_hours)))
        ):
            self.ok_line(f'{self.rel(path)} frontmatter is valid')

    def run(self) -> int:
        print(f'Clawa home doctor: {self.root}')
        self.check_root_docs()
        self.check_config()
        self.check_all_pulses()
        self.check_agents_budgets()
        print('\nSummary')
        print(f'OK: {self.ok}  WARN: {len(self.warns)}  FAIL: {len(self.fails)}')
        if self.fails:
            print('\nFix first:')
            for item in self.fails[:12]:
                print(f'- {item}')
            if len(self.fails) > 12:
                print(f'- ...and {len(self.fails) - 12} more')
            return 1
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Check a Clawa home for structural config/doc/pulse issues.'
    )
    parser.add_argument('path', nargs='?', default='.', help='Clawa home/project root')
    args = parser.parse_args()
    return Doctor(Path(args.path)).run()


if __name__ == '__main__':
    raise SystemExit(main())
