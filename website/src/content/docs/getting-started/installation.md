---
title: Installation
description: Install modern 0.4.0 into a separate Clawa home.
section: Start
order: 10
---

Clawa is a Pi package loaded from a git checkout, not a standalone agent runtime. Install it per
home through project settings or an explicit `-e` path, not globally. Keep the package checkout
separate from the folder that will become the Clawa's home.

These docs describe **modern 0.4.0**, the stable default released on **2026-10-01**.
Install **v0.4.0** for the release. The `modern` branch is an optional development checkout.
Use the [edition comparison](../../../../versions/) to choose between modern and legacy.

## What you need

- Git.
- Linux with `flock` available. Local memory uses Linux no-follow file checks and process locks.
- Node.js **24.15 or newer, but lower than 27**.
- [Pi](https://github.com/earendil-works/pi) **0.99.2 or newer**, with a configured model provider.
- A clean folder for the home. [First run](../first-run/) explains the exact bootstrap boundary.

Both modern **0.4.0** and supported legacy **0.3.1** require Pi **0.99.2 or newer**.
Neither maintained line supports older Pi installations. Legacy retains its RPC workers and
SQLite memory without adopting modern's runtime architecture. The historical `v0.3.0` tag stays
unchanged and does not include current maintenance.

Pi extensions execute with your user permissions. Read the [trust boundaries](../../reference/privacy/)
before putting personal context into a home.

## Install modern

Clone the stable release tag:

```bash
mkdir -p ~/src
git clone --branch v0.4.0 \
  https://github.com/IgorWarzocha/pi-clawa.git ~/src/pi-clawa
```

This leaves the checkout detached at the release commit. To follow development instead, replace
`v0.4.0` with `modern` in the clone command. Use `v0.3.1` and the
[legacy installation guide](../../../../legacy/docs/getting-started/installation/) if you want
the earlier architecture.

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

## Developing Clawa

Use a checkout of the `modern` branch for development, not the detached release tag.
Keep the full Git history. The strict gate builds modern docs from the working tree and maintained
legacy docs from Git. The build looks for local `legacy`, then `origin/legacy`. You can select an
available ref explicitly:

```bash
cd ~/src/pi-clawa
bun install
CLAWA_LEGACY_REF=origin/legacy bun run ai:check:strict
```

With either default ref available, run `bun run ai:check:strict` without the override. A shallow,
modern-only clone cannot build both editions. The [release policy](../../project/release-policy/)
explains how branch updates, docs deployments, and tagged releases differ.

The [files and runtime state](../../reference/files-state/) page separates home data from disposable
runtime artifacts and lists what belongs in a backup or ignore policy.

## Next

Start Pi in the home and continue to [First run](../first-run/). Clawa creates its own files; there is
no separate `init` or setup wizard.

For later updates or a legacy migration, follow [Upgrading](../../operate/upgrading/), including
its agent procedure and first restart checks.
