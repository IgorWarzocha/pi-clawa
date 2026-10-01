---
title: Installation
description: Install the maintained legacy line into a separate Clawa home.
section: Start
order: 10
---

Clawa is a Pi package loaded from a git checkout. It is not a standalone agent runtime and it is not
published to npm yet. Keep the package checkout separate from the folder that will become the
Clawa's home.

## What you need

- Git.
- Node.js **24.15 or newer, but lower than 27**.
- [Pi](https://github.com/earendil-works/pi) **0.99.2 or newer**, with a configured model provider.
- A clean folder for the home. [First run](../first-run/) explains the exact bootstrap boundary.

Pi extensions execute with your user permissions. Read the [trust boundaries](../../reference/privacy/)
before putting personal context into a home.

## Install legacy

Legacy keeps the earlier Clawa architecture on the current Pi baseline. Choose where package
checkouts live, then clone its maintained branch:

```bash
mkdir -p ~/src
git clone --branch legacy \
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

## Branches and releases

Current legacy maintenance is unreleased. The unchanged `v0.3.0` tag is the earlier release, not
this branch's current code. Modern develops a different Clawa architecture; it is not required to
keep legacy working with current Pi. The [release policy](../../project/release-policy/) explains
both lines, and the [edition comparison](https://igorwarzocha.github.io/pi-clawa/versions/) helps
you choose between them.

The [files and runtime state](../../reference/files-state/) page separates home data from disposable
runtime artifacts and lists what belongs in a backup or ignore policy.

## Next

Start Pi in the home and continue to [First run](../first-run/). Clawa creates its own files; there is
no separate `init` or setup wizard.
