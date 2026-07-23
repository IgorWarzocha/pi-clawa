---
title: Upgrading and removing
description: Update package code without replacing home state.
section: Operate
order: 90
---

Code and home state live in different folders. Upgrade the package checkout; do not replace the home
with a new template.

## Upgrade to a tagged release

Read the [changelog](../../../changelog/) first, stop the main Pi session cleanly, then update the
checkout:

```bash
cd ~/src/pi-clawa
git fetch --tags origin
git checkout v0.1.0
```

Start the home again with `pi -c`. Clawa reads existing `.pi/claw.jsonc` and living documents. It
does not recopy the template over a bootstrapped home.

For a full checkout rather than a shallow tagged clone, move between releases with
`git switch --detach vX.Y.Z`. A detached tag is expected for an installed package. Do not make local
product edits there unless you intentionally maintain a fork.

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
