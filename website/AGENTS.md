- This branch owns legacy docs and `../CHANGELOG.md`. Modern's shared frontend reads them from one Git snapshot; do not copy modern runtime instructions into this edition.
- `../CHANGELOG.md` is canonical. Never duplicate it here.
- Every user-visible behavior change belongs under `Unreleased` in the same change. Internal-only
  refactors do not need an entry.
- Docs explain shipped behavior from runtime source and tests. Label Discord and other unsettled
  behavior plainly instead of smoothing over it.
- Use root-relative site links through `withBase()` in Astro. Markdown pages use relative links.
- Keep CI, Pages, and Release workflows aligned across `modern` and `legacy`. Pages triggers on either maintained branch but always builds modern's shared frontend with `origin/legacy` as its legacy source; never deploy this branch's older frontend separately.
- Validate with `bun run docs:build`; the root strict gate includes it.
