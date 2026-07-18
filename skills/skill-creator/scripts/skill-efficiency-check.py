#!/usr/bin/env python3
"""Lightweight structural and prompt-efficiency checks for a SKILL.md."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import unquote


FORBIDDEN_HEADINGS = re.compile(
    r"^#{1,6}\s+(when to use|do not use when|activation|triggers?)\b", re.I | re.M
)
FIELD_RE = re.compile(r"^([A-Za-z0-9_-]+):(?:\s*(.*))?$")
NAME_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
BACKTICK_PATH_RE = re.compile(r"`((?:references|scripts|assets)/[^`]+)`")
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))")
PLAIN_NON_STRING_RE = re.compile(
    r"(?:~|null|true|false|yes|no|on|off|[-+]?(?:\.inf|\.nan|0x[0-9a-f_]+|0o[0-7_]+|"
    r"(?:\d[\d_]*)(?:\.\d[\d_]*)?(?:e[-+]?\d+)?))",
    re.I,
)
TIMESTAMP_RE = re.compile(r"\d{4}-\d{1,2}-\d{1,2}(?:[Tt ]|$)")
SUPPORT_PREFIXES = ("references/", "scripts/", "assets/")
YAML_SIMPLE_ESCAPES = {
    "0": "\0",
    "a": "\a",
    "b": "\b",
    "t": "\t",
    "n": "\n",
    "v": "\v",
    "f": "\f",
    "r": "\r",
    "e": "\x1b",
    " ": " ",
    '"': '"',
    "/": "/",
    "\\": "\\",
    "N": "\u0085",
    "_": "\u00a0",
    "L": "\u2028",
    "P": "\u2029",
}
YAML_HEX_ESCAPES = {"x": 2, "u": 4, "U": 8}
DESCRIPTION_HIGH_END = 812
DESCRIPTION_LIMIT = 1024
NAME_LIMIT = 64


def split_frontmatter(text: str) -> tuple[list[tuple[int, str]], str]:
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise ValueError("missing opening YAML frontmatter delimiter")

    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError("missing exact closing YAML frontmatter delimiter") from exc

    return list(enumerate(lines[1:end], start=2)), "\n".join(lines[end + 1 :]).lstrip("\n")


def parse_single_quoted_scalar(inner: str, line_number: int) -> str:
    result: list[str] = []
    index = 0
    while index < len(inner):
        if inner[index] != "'":
            result.append(inner[index])
            index += 1
            continue
        if index + 1 >= len(inner) or inner[index + 1] != "'":
            raise ValueError(f"unescaped quote in frontmatter value at line {line_number}")
        result.append("'")
        index += 2
    return "".join(result)


def parse_double_quoted_scalar(inner: str, line_number: int) -> str:
    result: list[str] = []
    index = 0
    while index < len(inner):
        char = inner[index]
        if char == '"':
            raise ValueError(f"unescaped quote in frontmatter value at line {line_number}")
        if char != "\\":
            result.append(char)
            index += 1
            continue

        index += 1
        if index >= len(inner):
            raise ValueError(f"unfinished escape in frontmatter value at line {line_number}")
        marker = inner[index]
        if marker in YAML_SIMPLE_ESCAPES:
            result.append(YAML_SIMPLE_ESCAPES[marker])
            index += 1
            continue
        if marker not in YAML_HEX_ESCAPES:
            raise ValueError(
                f"invalid YAML escape `\\{marker}` in frontmatter value at line {line_number}"
            )

        width = YAML_HEX_ESCAPES[marker]
        digits = inner[index + 1 : index + 1 + width]
        if len(digits) != width or not re.fullmatch(r"[0-9a-fA-F]+", digits):
            raise ValueError(f"invalid YAML unicode escape at line {line_number}")
        try:
            result.append(chr(int(digits, 16)))
        except ValueError as exc:
            raise ValueError(f"invalid YAML unicode code point at line {line_number}") from exc
        index += width + 1
    return "".join(result)


def parse_quoted_scalar(value: str, line_number: int) -> str:
    quote = value[0]
    if len(value) < 2 or not value.endswith(quote):
        raise ValueError(f"unterminated quoted frontmatter value at line {line_number}")
    inner = value[1:-1]
    return (
        parse_single_quoted_scalar(inner, line_number)
        if quote == "'"
        else parse_double_quoted_scalar(inner, line_number)
    )


def parse_scalar(value: str, line_number: int) -> str:
    if not value:
        return ""
    if value[0] in "\"'":
        return parse_quoted_scalar(value, line_number)
    if value[0] in "[{|>*&!" or PLAIN_NON_STRING_RE.fullmatch(value) or TIMESTAMP_RE.match(value):
        raise ValueError(
            f"frontmatter value at line {line_number} is not an unambiguous string; quote it"
        )
    if ": " in value or " #" in value:
        raise ValueError(
            f"frontmatter value at line {line_number} contains a plain-scalar trap; quote it"
        )
    return value


def parse_frontmatter(lines: list[tuple[int, str]]) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line_number, line in lines:
        if not line.strip() or line.lstrip().startswith("#") or line.startswith((" ", "\t")):
            continue
        match = FIELD_RE.fullmatch(line)
        if not match:
            raise ValueError(f"malformed top-level frontmatter at line {line_number}")
        key, raw_value = match.groups()
        if key in fields:
            raise ValueError(f"duplicate frontmatter field `{key}` at line {line_number}")
        fields[key] = (
            parse_scalar(raw_value or "", line_number)
            if key in {"name", "description"}
            else (raw_value or "")
        )
    return fields


def has_files(directory: Path) -> bool:
    return directory.is_dir() and any(path.is_file() for path in directory.rglob("*"))


def referenced_support_paths(body: str) -> list[str]:
    paths = set(BACKTICK_PATH_RE.findall(body))
    for angle_target, plain_target in MARKDOWN_LINK_RE.findall(body):
        target = unquote(angle_target or plain_target).split("#", 1)[0].split("?", 1)[0]
        if target.startswith(SUPPORT_PREFIXES):
            paths.add(target)
    return sorted(paths)


def support_path_issue(root: Path, relative_path: str) -> str | None:
    candidate = (root / relative_path).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return f"referenced local path escapes skill root: {relative_path}"
    if not candidate.is_file():
        return f"referenced local path is missing or not a file: {relative_path}"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run lightweight structural and prompt-efficiency checks on a SKILL.md."
    )
    parser.add_argument("skill", help="Path to SKILL.md or a skill directory")
    args = parser.parse_args()

    target = Path(args.skill).expanduser()
    if target.is_dir():
        target = target / "SKILL.md"
    target = target.resolve()
    root = target.parent

    issues: list[str] = []
    warnings: list[str] = []
    suggestions: list[str] = []
    fields: dict[str, str] = {}
    body = ""
    parsed = False

    if target.name != "SKILL.md" or not target.is_file():
        issues.append(f"missing SKILL.md: {target}")
    else:
        try:
            text = target.read_text(encoding="utf-8")
            frontmatter, body = split_frontmatter(text)
            fields = parse_frontmatter(frontmatter)
            parsed = True
        except (OSError, UnicodeError, ValueError) as exc:
            issues.append(str(exc))

    name = fields.get("name", "")
    description = fields.get("description", "")

    if parsed:
        if not name:
            issues.append("frontmatter missing name")
        else:
            if len(name) > NAME_LIMIT:
                issues.append(f"name too long: {len(name)} chars > {NAME_LIMIT}")
            if not NAME_RE.fullmatch(name):
                issues.append(f"name does not follow lowercase kebab-case: {name}")

        if not description:
            issues.append("frontmatter missing description")
        else:
            if not re.search(r"\buse (?:when|for)\b", description, re.I):
                warnings.append("description may not clearly say when to use the skill")
            if len(description) > DESCRIPTION_LIMIT:
                issues.append(
                    f"description too long: {len(description)} chars > Pi limit of {DESCRIPTION_LIMIT}"
                )
            elif len(description) > DESCRIPTION_HIGH_END:
                warnings.append(
                    f"description is on the higher end of Pi's allowed range: {len(description)} chars; "
                    "consider trimming without losing trigger coverage"
                )

    if FORBIDDEN_HEADINGS.search(body):
        issues.append("body contains trigger-selection headings; keep selection guidance in description")

    for relative_path in referenced_support_paths(body):
        if path_issue := support_path_issue(root, relative_path):
            issues.append(path_issue)

    if not has_files(root / "references"):
        suggestions.append(
            "no references found; consider whether detailed guidance, examples, or edge cases would help"
        )
    if not has_files(root / "scripts"):
        suggestions.append(
            "no scripts found; consider whether deterministic validation or transformation would help"
        )

    print("# Skill Efficiency Check\n")
    print(f"skill: {target}")
    print(f"description_chars: {len(description)}")
    visible_line = f"- {name}: {description} (file: {target})\n"
    visible_tokens = (len(visible_line.encode("utf-8")) + 3) // 4
    print(f"model_visible_line_tokens_estimate: {visible_tokens}")
    print(f"body_chars: {len(body)}")
    print(f"body_lines: {len(body.splitlines())}")
    print("\n## Issues")
    print("- none" if not issues else "\n".join(f"- {item}" for item in issues))
    print("\n## Warnings")
    print("- none" if not warnings else "\n".join(f"- {item}" for item in warnings))
    print("\n## Suggestions")
    print("- none" if not suggestions else "\n".join(f"- {item}" for item in suggestions))

    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main())
