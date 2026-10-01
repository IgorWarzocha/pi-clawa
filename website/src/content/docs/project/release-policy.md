---
title: Release policy
description: How the modern and legacy release channels, development, and docs fit together.
section: Project
order: 160
---

**Modern 0.4.0** is the stable default. **Legacy 0.3.1** is the supported earlier architecture.
Both releases are dated **2026-10-01**. Install `v0.4.0` by default or `v0.3.1` to retain legacy.
The `modern` branch follows optional development, and `legacy` follows maintenance.

Legacy keeps RPC workers, SQLite memory, and its in-session memory pass. It is not a frozen
archive. Both maintained lines require Pi **0.99.2 or newer** and move to the current Pi baseline
together, without older-Pi compatibility paths. Legacy maintenance does not merge modern's runtime
architecture back into it.

The old `v0.3.0` tag stays unchanged and does not include later legacy branch updates.
Tags identify releases; a branch update or merge is not a release. The
[edition comparison](../../../../versions/) describes the runtime differences.

## Changelog

Each line's root `CHANGELOG.md` is its changelog authority. The site renders modern's working-tree
changelog and legacy's selected Git snapshot separately. Do not copy historical entries between them
to imply that both lines shipped the same behavior.

Every user-visible behavior change updates **Unreleased** in the same commit or pull request:

- **Added** for new behavior;
- **Changed** for a changed contract or default;
- **Fixed** for corrected behavior;
- **Removed** for a deleted surface;
- **Security** for relevant trust or exposure changes;
- **Known limitations** for a limitation readers need before upgrading.

Internal refactors, tests, and documentation-only corrections do not need entries. Write for the
person updating a live home: say what changed and what they may need to do.

## Preparing a release

Release a coherent batch, not every merge. Before dispatching the release workflow:

1. choose the version and curate a dated changelog section;
2. update the root, website, and Discord package versions together within that line, including
   the lockfile;
3. complete a clean-room install and runtime pass for changed behavior;
4. pass `bun run ai:check:strict`;
5. document every state migration and rollback limit;
6. update edition notices and installation targets for the new release across HTML, plain
   Markdown, and `llms.txt`.

Move accumulated Unreleased entries under `## [X.Y.Z] - YYYY-MM-DD`, update comparison links,
and leave a fresh Unreleased section. Discord stays lockstep with the repository release while it
is local-workspace and WIP. npm publishing is not part of this workflow.

## Release automation

The maintainer manually dispatches **Release** with a semantic version and explicit confirmation.
The workflow verifies that:

- it runs from `modern` or `legacy`;
- package versions match the input;
- `CHANGELOG.md` contains that dated version;
- the strict gate passes.

It then creates the `vX.Y.Z` tag and GitHub release from the changelog section. The tag makes the
batch installable as a release. Tags are unique across the repository, not per branch. Choose an
unused version for either line. An existing tag must point to the workflow commit; never move
`v0.3.0` or another published tag to include maintenance changes.

## Docs deployment

The same Pages workflow on both maintained branches builds both editions with one shared frontend:

- every run checks out `modern` with full history, even when triggered by a legacy update;
- modern docs and changelog come from that checkout;
- legacy docs and changelog come from one `origin/legacy` commit, with no hand-maintained copy;
- each edition has its own docs and changelog routes;
- the comparison lives at `/versions/`.

Docs, changelog, workflow, and build-input pushes on either branch trigger the shared deployment.
Workflow guards allow only `modern` and `legacy`, including manual dispatch. Before publication,
configure the GitHub `github-pages` environment to permit both maintained branches. Legacy updates
refresh the legacy edition through modern's frontend, not a separate site. Publishing corrected
docs does not release the extension.

## Local validation

The strict gate builds both editions. Use a full-history clone. The build looks for local `legacy`,
then `origin/legacy`, or you can choose an available Git ref explicitly:

```bash
CLAWA_LEGACY_REF=origin/legacy bun run ai:check:strict
```

A shallow modern-only checkout is not sufficient. The build must fail if the requested legacy
source is unavailable, rather than quietly publishing only modern or substituting another edition.
