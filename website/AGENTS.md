- Modern owns this shared frontend and `src/content/docs`. Legacy is a preserved archive, not a
  second copy to synchronize. Never edit legacy branch code or workflows to maintain this site.
- Build and dev snapshot one Git commit into ignored `.generated/legacy`. `CLAWA_LEGACY_REF`
  overrides local `legacy`, then `origin/legacy`. Never substitute the current worktree.
- Modern changelog comes from `../CHANGELOG.md`; legacy comes from the same snapshot as its docs.
- Modern describes active, unreleased work. Legacy describes its preserved runtime. Label Discord
  and other unsettled behavior plainly.
- Use root-relative site links through `withBase()` in Astro. Markdown pages use relative links.
- Plain Markdown lives at each guide's `index.md` so its relative links resolve like the HTML page.
  Generate it and `llms.txt` from the same collections; the upgrade guide owns the agent procedure.
- Old `/docs/` bookmarks prefer legacy to preserve released links; modern-only IDs fall back to
  modern. Unversioned `/changelog/` follows modern's cumulative history.
- Modern alone owns the single Pages deployment containing both editions. Preserve that boundary
  in workflow guards and GitHub's Pages environment deployment-branch policy.
- Validate with `bun run docs:build`; the root strict gate includes it.
