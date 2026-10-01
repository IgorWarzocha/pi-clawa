---
title: Upgrading and removing
description: Upgrade to legacy 0.3.1 without replacing home state.
section: Operate
order: 90
---

Code and home state live in different folders. Upgrade the package checkout; do not replace the home
with a new template.

## Update legacy

Read the [changelog](../../../changelog/) first. **Legacy v0.3.1**, released on **2026-10-01**,
requires Pi **0.99.2 or newer** and does not require a home-state migration. Record the starting
commit and check for local edits before updating; do not reset or overwrite them. Upgrade Pi and
stop the main session and any manual worker panels cleanly, then update the checkout:

```bash
cd ~/src/pi-clawa
git fetch origin tag v0.3.1
git switch --detach v0.3.1
```

Stop on a fetch error or tag conflict; never force-update a published tag. These commands select
the stable legacy release, including from an older tagged or single-branch checkout. A detached
checkout is expected; do not make local product edits unless you intentionally maintain a fork.

Start the home again with `pi -c`. Clawa reads existing `.pi/claw.jsonc` and living documents. It
does not recopy the template over a bootstrapped home.

To follow maintenance between releases instead, use `git fetch origin legacy` followed by
`git switch --detach FETCH_HEAD` in the stopped checkout. This selects that fetched snapshot;
repeat the two commands for a later maintenance update.

The historical `v0.3.0` tag does not include this maintenance. Future tags remain deliberate release
batches, not automatic branch updates. Moving to **modern v0.4.0** is a separate, optional architecture
change; follow
[modern's migration guide](https://igorwarzocha.github.io/pi-clawa/modern/docs/operate/upgrading/)
rather than changing branches in a running legacy home.

## Back up what matters

Before a risky migration, stop Pi and follow the backup map in
[Files and runtime state](../../reference/files-state/). Pi's main and worker sessions do not all
live in the same place.

## Roll back

Stop Pi, check out the previous release tag, then resume. A rollback is safe only when the changelog
does not call out an irreversible state migration. pi-clawa 0.1.0 has no automatic living-document
migration system; state compatibility remains a release responsibility.

## Remove the extension

1. Stop the main Pi session and any manual worker panels.
2. Remove the pi-clawa package path from the home's `.pi/settings.json`.
3. Start Pi once without the package if you want to verify plain-Pi behavior.
4. Delete the package checkout when no homes reference it.

Removing the package does **not** delete living documents, worker homes, memory, sessions, Pulse
state, or Discord state. They are your data. Delete them only when you have decided they are no longer
needed.
