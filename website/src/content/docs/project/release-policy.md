---
title: Release policy
description: How modern development, legacy preservation, docs, and releases fit together.
section: Project
order: 160
---

`modern` is the intended default and active development line. It is currently **unreleased**.
No modern release version has been chosen. Package manifests still reading `0.3.0` do not make
modern a 0.3.0 release.

`legacy` preserves the released 0.3.0 line. Modern changes are not automatically copied back to it.
Tags identify releases; a branch update or merge is not a release. The
[edition comparison](../../../../versions/) describes the runtime differences.

## Changelog

Each line's root `CHANGELOG.md` is its changelog authority. The site renders modern's working-tree
changelog and legacy's archived Git source separately. Do not copy historical entries between them
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
2. update the root, website, and Discord package versions together;
3. complete a clean-room install and runtime pass for changed behavior;
4. pass `bun run ai:check:strict`;
5. document every state migration and rollback limit.

Move accumulated Unreleased entries under `## [X.Y.Z] - YYYY-MM-DD`, update comparison links,
and leave a fresh Unreleased section. Discord stays lockstep with the repository release while it
is local-workspace and WIP. npm publishing is not part of this workflow.

## Release automation

The maintainer manually dispatches **Release** with a semantic version and explicit confirmation.
The workflow verifies that:

- it runs from `modern`;
- package versions match the input;
- `CHANGELOG.md` contains that dated version;
- the strict gate passes.

It then creates the `vX.Y.Z` tag and GitHub release from the changelog section. The tag makes the
batch installable as a release. This workflow does not release legacy.

## Docs deployment

Modern's Pages workflow builds both editions with one shared frontend:

- modern docs come from the working tree;
- legacy docs and changelog come unchanged from the selected legacy Git source;
- each edition has its own docs and changelog routes;
- the comparison lives at `/versions/`.

Before the first dual-edition publication, restrict the GitHub `github-pages` environment's
deployment branches to `modern`. Legacy's historical Pages workflow remains preserved, including
manual dispatch. Modern's workflow guards do not disable that old workflow; the environment's
branch policy enforces modern-only deployment.

Modern docs, changelog, and relevant workflow changes trigger deployment. With that environment
policy in place, frozen legacy cannot deploy independently. Publishing corrected docs does not
release the extension.

## Local validation

The strict gate builds both editions. Use a full-history clone. The build looks for local `legacy`,
then `origin/legacy`, or you can choose an available Git ref explicitly:

```bash
CLAWA_LEGACY_REF=origin/legacy bun run ai:check:strict
```

A shallow modern-only checkout is not sufficient. The build must fail if the requested legacy
source is unavailable, rather than quietly publishing only modern or substituting another edition.
