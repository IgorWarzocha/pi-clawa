#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
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
THINKING_LEVELS = {'off', 'minimal', 'low', 'medium', 'high', 'xhigh'}
REPORT_MODES = {'auto', 'explicit', 'off'}
WORKER_ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]*$')
PULSE_ID_RE = WORKER_ID_RE
FRONTMATTER_RE = re.compile(r'^---\n(.*?)\n---\n?', re.S)
SCHEDULE_PATTERNS = [
    re.compile(r'^manual$', re.I),
    re.compile(
        r'^every\s+\d+\s*(m|min|mins|minute|minutes|h|hr|hour|hours|d|day|days)$',
        re.I,
    ),
    re.compile(r'^daily\s+([01]?\d|2[0-3]):[0-5]\d$', re.I),
    re.compile(
        r'^weekly\s+(sun|mon|tue|wed|thu|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+([01]?\d|2[0-3]):[0-5]\d$',
        re.I,
    ),
    re.compile(r'^at\s+\d{4}-\d{2}-\d{2}T.+$', re.I),
]


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
    return any(pattern.match(value.strip()) for pattern in SCHEDULE_PATTERNS)


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
        total = sum(estimate_tokens(path) for path in paths if path.exists())
        if total > 20_000:
            self.warn(f'{name} hydration estimate is large: ~{total} tokens (>20k)')
        else:
            self.ok_line(f'{name} hydration estimate ~{total} tokens')

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
                limit = 1_000
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
        else:
            self.ok_line(f'{self.rel(path)} frontmatter is valid')

    def run(self) -> int:
        print(f'Clawa house doctor: {self.root}')
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
        description='Check a Clawa house for structural config/doc/pulse issues.'
    )
    parser.add_argument('path', nargs='?', default='.', help='Clawa home/project root')
    args = parser.parse_args()
    return Doctor(Path(args.path)).run()


if __name__ == '__main__':
    raise SystemExit(main())
