---
title: Installation
description: Install a tagged checkout into a separate Clawa home.
section: Start
order: 10
---

Clawa is a Pi package loaded from a git checkout, not a standalone agent runtime. Install it per
home through project settings or an explicit `-e` path, not globally. Keep the package checkout
separate from the folder that will become the Clawa's home.

## What you need

- Git.
- Linux with `flock` available; local memory uses Linux no-follow file checks and process locks.
- Node.js **24.15 or newer, but lower than 27**.
- [Pi](https://github.com/earendil-works/pi) **0.87.1 or newer**, with a configured model provider.
- A clean folder for the home. [First run](../first-run/) explains the exact bootstrap boundary.

Pi extensions execute with your user permissions. Read the [trust boundaries](../../reference/privacy/)
before putting personal context into a home.

## Install a tagged release

Choose where package checkouts live, then clone the release:

```bash
mkdir -p ~/src
git clone --branch v0.3.0 --depth 1 \
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

## Global installs stay out of ordinary projects

Global installation is discouraged. Dormancy is a safety net, not an alternative setup path.
A globally loaded Clawa activates in an existing home with `.pi/claw.jsonc`. Without that config,
it stays dormant: no Clawa tools, skills, prompt changes, or running home services.

A project-local install or explicit `pi -e ~/src/pi-clawa` is a deliberate request to make a home.
These still bootstrap automatically in a clean folder. First run creates files but waits for the
first human message or task before starting a conversation. Pi Codex is optional, not an install
requirement.

## Follow development instead

If you explicitly want unreleased work, clone `master` without `--branch`. Treat that checkout as a
development channel. The [release policy](../../project/release-policy/) explains what does and does
not ship from it.

The [files and runtime state](../../reference/files-state/) page separates home data from disposable
runtime artifacts and lists what belongs in a backup or ignore policy.

## Next

Start Pi in the home and continue to [First run](../first-run/). Clawa creates its own files; there is
no separate `init` or setup wizard.
