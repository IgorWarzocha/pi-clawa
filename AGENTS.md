# AGENTS.md

- This repo packages Clawa as a Pi extension: a warm, long-lived home layer over Pi, not a standalone agent runtime.
- Root `AGENTS.md` is maintainer guidance; `templates/main/AGENTS.md` is product template. Do not blur them.
- Keep setup automatic. If first run is rough, fix the boot/runtime path instead of adding `init`, `doctor`, or setup ceremony.
- Prefer living runtime behavior over markdownware/scriptware. Add docs/scripts only when they have a clear future reader/runner.
- Before adding behavior, trace the owning entrypoint and reuse/refactor existing seams; avoid parallel logic.
- Product shape is connected across runtime, templates, `skills/clawa-ops`, README, and tests; update the whole chain when changing how Clawa homes operate.
- Use repo-local `.pi/skills/agent-native-hardening` for structural cleanup and `.pi/skills/gh-issue-pr-flow` for GitHub flow.
- Keep README/user copy warm and user-facing; avoid dev-note-first framing.
- Discord adapter is WIP and belongs in the Discord section of TODO, not mixed into core runtime polish.
- Do not add performative tests. Keep tests for behavior that typechecking or code shape does not already cover.
- Release gate: `bun run ai:check:strict`. Do not add broad ignores to make it pass.
- Package install is git-first for now; npm publishing remains later.
