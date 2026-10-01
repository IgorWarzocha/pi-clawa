---
title: Release policy
description: How the legacy and modern release channels, maintenance, and docs fit together.
section: Project
order: 160
---

**Legacy 0.3.1** maintains the earlier Clawa architecture: RPC workers, shared SQLite memory, and
the same-branch memory pass. **Modern 0.4.0** is the stable default for new homes. Both releases are
dated **2026-10-01** and require Pi **0.99.2 or newer**. Install `v0.3.1` to retain legacy, or
`v0.4.0` for modern. The `legacy` branch follows maintenance; `modern` follows development.

Both maintained lines move to the current Pi baseline together, without older-Pi compatibility
paths. Legacy is supported, not a frozen archive, and does not adopt modern's runtime architecture.
The historical `v0.3.0` tag stays unchanged and excludes later maintenance. The
[edition comparison](https://igorwarzocha.github.io/pi-clawa/versions/) describes the differences.

## Changelog discipline

Each branch's root `CHANGELOG.md` is its changelog authority. The shared site renders them
separately. Do not copy modern entries into legacy to imply that both shipped the same behavior.
Every user-visible change updates **Unreleased** in the same commit or pull request:

- **Added** for new behavior;
- **Changed** for a changed contract or default;
- **Fixed** for corrected behavior;
- **Removed** for a deleted surface;
- **Security** for relevant trust or exposure changes;
- **Known limitations** when users need a sharp edge before upgrading.

Internal refactors, tests, and documentation-only corrections do not need performative entries. Write
for the person updating a live home: say what changed and what they may need to do.

## When to release

Release when a coherent batch is worth asking users to absorb—not after every merge and not on a
calendar for its own sake. A batch should have:

1. a curated versioned changelog section with a date;
2. matching root, docs, and Discord package versions within that line, including the lockfile;
3. a clean-room install/runtime pass for behavior that changed;
4. `bun run ai:check:strict` green;
5. no known state migration left implicit;
6. current edition notices and installation targets on the shared site, including plain Markdown
   and `llms.txt`.

Discord remains lockstep with the repository release while it is local-workspace and WIP. npm
publishing is not part of the current release workflow.

## Automation boundary

Normal pushes on either maintained branch and pull requests run the strict gate. The same Pages
workflow on both branches always checks out `modern` with full history and builds its shared
frontend. Modern docs come from that checkout; legacy docs and changelog come from one
`origin/legacy` commit. This branch's older frontend is not deployed separately.

Docs, changelog, workflow, and build-input pushes on either branch trigger the shared deployment.
The GitHub `github-pages` environment must permit both maintained branches before publication.
A documentation correction is not an extension release.

The maintainer manually dispatches **Release** with a semantic version and an explicit confirmation.
The workflow verifies:

- it runs from `modern` or `legacy`;
- package versions match the input;
- `CHANGELOG.md` contains that dated version;
- the full strict gate passes.

It then creates the `vX.Y.Z` tag and GitHub release from that changelog section. Tags are unique
across the repository, not per branch. Choose an unused version for either line. An existing tag
must point to the workflow commit; never move `v0.3.0` or another published tag to include updates.

## Preparing the next batch

Move the accumulated Unreleased entries under `## [X.Y.Z] - YYYY-MM-DD`, update comparison links and
package versions, then leave a fresh Unreleased section at the top. Do this before dispatching the
workflow. The tag is the point at which the batch becomes installable.

## Local validation

Run `bun run ai:check:strict` on each changed branch. Legacy's gate validates its runtime and
docs source. Modern's gate also builds both editions from a full-history checkout, selecting
local `legacy`, then `origin/legacy`, or an explicit `CLAWA_LEGACY_REF`.

The shared build must fail when the selected legacy source is unavailable, not substitute modern
docs or silently omit an edition.
