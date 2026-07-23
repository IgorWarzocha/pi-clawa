---
title: Release policy
description: Why master collects work, how Unreleased stays useful, what the manual release workflow checks, and when a change earns a tagged batch.
section: Project
order: 160
---

pi-clawa ships in batches. `master` is the development line; tags are the update channel for homes
that should not absorb every small fix as it lands.

## Changelog discipline

The root `CHANGELOG.md` is canonical and this site renders it directly. Every user-visible change
updates **Unreleased** in the same commit or pull request:

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
2. matching root, docs, and Discord package versions;
3. a clean-room install/runtime pass for behavior that changed;
4. `bun run ai:check:strict` green;
5. no known state migration left implicit.

Discord remains lockstep with the repository release while it is local-workspace and WIP. npm
publishing is not part of the current release workflow.

## Automation boundary

Normal pushes and pull requests run the strict gate, including the static docs build. They do **not**
deploy Pages or create a release.

The maintainer manually dispatches **Release and deploy Pages** with a semantic version and an
explicit confirmation. The workflow verifies:

- it runs from `master`;
- package versions match the input;
- `CHANGELOG.md` contains that dated version;
- the full strict gate passes.

It then creates the `vX.Y.Z` GitHub release from that changelog section and deploys the exact same
commit's static site. A failed Pages deploy can be rerun without manufacturing a second release.

## Preparing the next batch

Move the accumulated Unreleased entries under `## [X.Y.Z] - YYYY-MM-DD`, update comparison links and
package versions, then leave a fresh Unreleased section at the top. Do this before dispatching the
workflow. The tag is the point at which the batch becomes installable.
