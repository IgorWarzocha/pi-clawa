---
title: Installation
description: Put the extension and the Clawa home in separate folders, pin a release, and let Pi load it for that home.
section: Start
order: 10
---

Clawa is a Pi package loaded from a git checkout. It is not a standalone agent runtime and it is not
published to npm yet. Keep the package checkout separate from the folder that will become the
Clawa's home.

## What you need

- Git.
- Node.js **24.15 or newer, but lower than 27**.
- [Pi](https://github.com/earendil-works/pi-mono) with a configured model provider. pi-clawa 0.1.0
  is developed and tested against Pi 0.80.6.
- A clean folder for the home. “Clean” matters: existing Clawa core documents block bootstrap.
- A persistent terminal on an always-on host if you want scheduled Pulses or the Discord adapter.

Pi extensions execute with your full user permissions. Read the source you install and pin a tagged
release rather than silently following `master`.

## Install a tagged release

Choose where package checkouts live, then clone the release:

```bash
mkdir -p ~/src
git clone --branch v0.1.0 --depth 1 \
  https://github.com/IgorWarzocha/pi-clawa.git ~/src/pi-clawa
```

Create a separate home:

```bash
mkdir -p ~/clawa-home
cd ~/clawa-home
```

You can try it directly:

```bash
pi -e ~/src/pi-clawa
```

For a permanent project-local install, run the helper **from the home**:

```bash
~/src/pi-clawa/scripts/install-project.sh
pi
```

The helper writes `.pi/settings.json` with the package checkout in `packages`. It refuses to replace
an existing settings file. If the home already has Pi settings, merge this entry yourself instead:

```json
{
  "packages": ["/home/you/src/pi-clawa"]
}
```

Do not use `CLAWA_INSTALL_OVERWRITE=1` casually. It replaces the complete settings file, not only
the package list.

## Follow development instead

If you explicitly want unreleased work, clone `master` without `--branch`. Treat that checkout as a
development channel: behavior may move between tagged batches. The release policy intentionally
does not deploy the public site or create a release for every push to `master`.

## Keep private state out of git

A Clawa home is personal state, not a normal source checkout. If you do version parts of it, ignore
at least:

```text
.pi/claw.jsonc
.pi/clawa-memory.sqlite
.pi/clawas/
.pi/clawas-control/
.pi/clawa-discord/
```

Living documents may contain private context too. Decide deliberately which, if any, belong in a
remote repository.

## Next

Start Pi in the home and continue to [First run](../first-run/). Clawa creates its own files; there is
no separate `init` or setup wizard.
