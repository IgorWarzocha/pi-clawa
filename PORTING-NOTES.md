# Porting notes

Current state:
- core package is `@howaboua/pi-claw`
- Discord adapter package lives in `packages/pi-claw-discord/`
- core HOWABANDA extension code is copied into the package root
- extension package manifest points Pi at `./index.ts`
- old GUI primitives SDK dependency is removed
- GUI primitives are local in `gui-primitives.ts` and use `@earendil-works/pi-tui`
- main-claw bootstrap templates live under `templates/main/`
- one generic worker skeleton lives under `templates/worker/`
- one generic HOWABANDA config example lives under `templates/howabanda/config.jsonc`

Before publishing:
- finish the adapter seam between core and optional packages
- add real `init` / `doctor`
- make `typecheck:full` clean; current `typecheck` is syntax-only during extraction
