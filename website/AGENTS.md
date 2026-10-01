- Modern owns the shared frontend. Each branch owns its docs, changelog, and runtime; legacy is
  supported, not frozen. Maintain compatibility without copying modern runtime architecture back.
- Build and dev snapshot one Git commit into ignored `.generated/legacy`. `CLAWA_LEGACY_REF`
  overrides local `legacy`, then `origin/legacy`. Never substitute the current worktree.
- Modern changelog comes from `../CHANGELOG.md`; legacy comes from the same snapshot as its docs.
- Modern 0.4.0 is the stable default; `modern` follows optional development. Legacy 0.3.1 remains
  supported with RPC workers and SQLite memory. Both require Pi 0.99.2+. Keep release notices in
  `src/lib/site.ts` aligned with install targets; never relabel the historical `v0.3.0` tag.
  Label Discord and other unsettled behavior plainly.
- Use root-relative site links through `withBase()` in Astro. Markdown pages use relative links.
- Plain Markdown lives at each guide's `index.md` so its relative links resolve like the HTML page.
  Generate it and `llms.txt` from the same collections; the upgrade guide owns the agent procedure.
- Old `/docs/` bookmarks prefer legacy to preserve released links; modern-only IDs fall back to
  modern. Unversioned `/changelog/` follows modern's cumulative history.
- Shared Pages workflows on both branches always build the modern frontend with `origin/legacy`
  as the snapshot source. Allow both maintained branches in guards and the Pages environment policy.
- Validate with `bun run docs:build`; the root strict gate includes it.
