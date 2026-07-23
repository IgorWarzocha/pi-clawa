- This is the static GitHub Pages source. Keep it dark, dense, direct, and useful; no SaaS chrome.
- `../CHANGELOG.md` is canonical and rendered directly at `/changelog/`. Never duplicate it here.
- Every user-visible behavior change belongs under `Unreleased` in the same change. Internal-only
  refactors do not need an entry.
- Docs explain shipped behavior from runtime source and tests. Label Discord and other unsettled
  behavior plainly instead of smoothing over it.
- Use root-relative site links through `withBase()` in Astro. Markdown pages use relative links.
- Validate with `bun run docs:build`; the root strict gate includes it.
