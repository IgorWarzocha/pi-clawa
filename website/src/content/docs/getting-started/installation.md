---
title: Installation
description: Install a tagged checkout into a separate Clawa home.
section: Start
order: 10
---

Clawa is a Pi package loaded from a git checkout. It is not a standalone agent runtime and it is not
published to npm yet. Keep the package checkout separate from the folder that will become the
Clawa's home.

## What you need

- Git.
- Node.js **24.15 or newer, but lower than 27**.
- [Pi](https://github.com/earendil-works/pi-mono) with a configured model provider.
- A clean folder for the home. [First run](../first-run/) explains the exact bootstrap boundary.

Pi extensions execute with your user permissions. Read the [trust boundaries](../../reference/privacy/)
before putting personal context into a home.

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
development channel. The [release policy](../../project/release-policy/) explains what does and does
not ship from it.

The [files and runtime state](../../reference/files-state/) page separates home data from disposable
runtime artifacts and lists what belongs in a backup or ignore policy.

## Next

Start Pi in the home and continue to [First run](../first-run/). Clawa creates its own files; there is
no separate `init` or setup wizard.
