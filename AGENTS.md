# AGENTS.md

- This repo packages Clawa as a Pi extension: a warm, long-lived home layer over Pi, not a standalone agent runtime.
- `legacy` maintains the earlier Clawa architecture; `modern` is the default development line. Move both to the current Pi baseline together, without older-Pi compatibility paths. Do not merge modern's runtime architecture into legacy.
- Root `AGENTS.md` is maintainer guidance; `templates/main/AGENTS.md` is product template. Do not blur them.
- Keep setup automatic. If first run is rough, fix the boot/runtime path instead of adding `init`, `doctor`, or setup ceremony.
- Prefer living runtime behavior over markdownware/scriptware. Add docs/scripts only when they have a clear future reader/runner.
- Before adding behavior, trace the owning entrypoint and reuse/refactor existing seams; avoid parallel logic.
- Product shape is connected across runtime, templates, `skills/clawa-ops`, README, and tests; update the whole chain when changing how Clawa homes operate.
- Use repo-local `.pi/skills/agent-native-hardening` for structural cleanup and `.pi/skills/gh-issue-pr-flow` for GitHub flow.
- Keep README/user copy warm and user-facing; avoid dev-note-first framing.
- Keep Discord-specific follow-ups in TODO.md's adapter section, not mixed into core runtime polish.
- Tests are a contract spine, not a feature inventory: keep deterministic boundary, persistence, ordering, and failure-state checks; reject type-shape, UI/copy/registration, and external-API simulation tests.
- Release gate: `bun run ai:check:strict`. Do not add broad ignores to make it pass.
- Follow `website/src/content/docs/project/release-policy.md` when shipping a batch. A merge is not
  a release: update lockstep versions and dispatch the manual Release workflow for the tagged update.
- Package install is git-first for now; npm publishing remains later.
