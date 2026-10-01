---
title: Upgrading and removing
description: Upgrade to modern 0.4.0 or migrate from legacy without replacing your home.
section: Operate
order: 90
---

Code and home state live in separate folders. Update the package checkout, not the home template.
**Modern v0.4.0 is the stable default. Legacy v0.3.1 remains supported.** Both releases are dated
**2026-10-01** and require Pi **0.99.2 or newer**. The `modern` branch is optional development,
not the stable install target. The historical `v0.3.0` tag stays unchanged.

This guide updates modern or migrates to it. Moving to modern is optional, not a prerequisite for
Pi **0.99.2** compatibility. To keep the legacy architecture, use the
[legacy guides](../../../../legacy/docs/getting-started/installation/) and
[legacy changelog](../../../../legacy/changelog/), not the migration below.

Read the [modern changelog](../../../changelog/) before updating. Back up the home using
[Files and runtime state](../../reference/files-state/), including the actual main and worker
session locations. Stop the main Pi session and all worker tabs using the checkout before changing
its code. Modern worker tabs do not stop when main exits.

## For an agent handling the upgrade

Keep explanation and execution separate. If asked to explain, inspect only what you are allowed
to read and give machine-specific steps. Do not change code, config, sessions, or services.
If asked to execute, establish which checkout and homes are in scope, whether remote access is
allowed, and who will stop and restart their sessions. Upgrade approval is not permission to
discard local edits, replace fork remotes, or change global Pi settings or provider credentials.
Confirm that modern is the chosen target before using this procedure. A request to update legacy
does not authorize migrating its architecture.

1. **Identify the installation.** Read the loaded package path from Pi project settings, explicit
   launch arguments, or global settings if used. Resolve symlinks to the actual checkout. Find the
   main home's `.pi/claw.jsonc` and resolve its worker `cwd` entries from that home. Record other
   homes known to use the same checkout. Do not assume the example `~/src/pi-clawa` or
   `~/clawa-home` paths match this machine.
2. **Inspect Git before changing it.** In the resolved checkout, record `git status --short --branch`,
   `git rev-parse HEAD`, and `git remote -v`. Identify the branch or detached tag and preserve the
   starting commit for rollback. Stop on local changes or an unexpected remote and ask how to
   proceed. Do not reset, clean, stash, or rewrite remotes silently. Redact credentials in reported
   remote URLs.
3. **Verify the target.** Default to the stable `v0.4.0` tag. With remote access authorized, use
   `git ls-remote --exit-code --tags origin refs/tags/v0.4.0 'refs/tags/v0.4.0^{}'` from that
   checkout. Record the target commit, using the peeled `^{}` entry for an annotated tag.
   Only if development was explicitly chosen, use
   `git ls-remote --exit-code --heads origin refs/heads/modern` instead. If the chosen ref is
   unavailable, or `origin` is an unexpected fork, stop and explain the missing source.
   Do not substitute another tag or branch or add a different remote without approval.
   Check the [installation requirements](../../getting-started/installation/#what-you-need) too.
4. **Plan the backup and restart.** Use the existing
   [backup map](../../reference/files-state/#what-to-back-up). Identify the actual main session
   file and worker session locations, not only the house catalog. Choose a backup location outside
   the data being migrated and record how the original main session will be resumed. Capture the
   final backup after shutdown and before code changes or the first modern start. Verify the backup
   contains the selected home data and session files before proceeding.
5. **Hand off if upgrading this session.** An agent inside a Clawa session that uses the checkout
   cannot shut down that session and continue the upgrade from it. Give the user or a separate,
   authorized supervisor the resolved paths, starting and target commits, backup plan, and the
   applicable steps below. Do not kill your own host, rewrite its loaded code, or promise to keep
   working after shutdown. Resume verification only when a new session is actually running.
6. **Use the applicable procedure.** For an existing modern checkout, follow
   [Update modern](#update-modern). For a legacy home, follow
   [Move a legacy home to modern](#move-a-legacy-home-to-modern), including the old Discord gateway
   shutdown before main and workers. Confirm all sessions using this checkout have stopped and
   the backup is complete before running its Git steps. Then perform the
   [first restart checks](#first-restart-checks).

If execution is unavailable, return a short handoff with exact paths and commands for this
machine, who must run them, and where to stop on an error. Distinguish completed steps from planned
or unverified steps. Reading this guide or switching branches does not validate a live upgrade.

## Update modern

For the stable release, after stopping sessions and completing the backup:

```bash
cd ~/src/pi-clawa
git fetch origin tag v0.4.0
git rev-parse 'v0.4.0^{commit}'
```

Confirm that the resolved commit matches the target recorded during verification. Stop on a
fetch error or mismatch. Do not force-update an existing local tag. Then switch to the release:

```bash
git switch --detach v0.4.0
```

This also works for a checkout cloned from a single branch or tag. A detached checkout at the
release commit is expected.

### Follow development instead

Only use the `modern` branch if development is the approved target:

```bash
cd ~/src/pi-clawa
git remote set-branches --add origin modern
git fetch origin
git switch modern
git merge --ff-only origin/modern
```

If no local `modern` branch exists, use `git switch --track origin/modern` for the switch step.
Adding the fetch branch does not replace the remote URL. Confirm the resulting commit matches
the recorded target. If the remote moved, stop and verify the new target before proceeding.

For either channel, stop on local changes, tag conflicts, or a divergent branch instead of
resetting or forcing the update. Start Pi from the home with `pi -c` after the update. Clawa reads
the existing config and living documents without copying the template over them.

## Move a legacy home to modern

Switching lines changes runtime behavior and memory layout. Make a backup **before the first
modern start**. A package-code rollback alone does not undo the migration.

1. If the old Discord gateway is running, stop it through the old `/discord` before updating.
2. Stop the old main Pi session so its managed RPC workers shut down. Close any separate worker
   panels too.
3. Fetch the stable release in the package checkout:

   ```bash
   git fetch origin tag v0.4.0
   git rev-parse 'v0.4.0^{commit}'
   ```

   Confirm the commit matches the verified target, then run `git switch --detach v0.4.0`.
   Stop on a fetch error or mismatch. Never force-update an existing tag. These steps also work
   for a legacy checkout cloned from a single branch or tag. If development was explicitly
   approved instead, use [Follow development instead](#follow-development-instead).
4. Remove obsolete `contextManagement`, `memoryPass`, and `memoryPassThreshold` config entries.
5. Resume the home with `pi -c` and check startup notices before sending more work.

Modern runs specialists in Herdr tabs or tmux windows instead of managed RPC workers. Existing
session history stays in place. Plain Pi owns compaction, or optional Pi Codex owns its configured
continuity. Clawa no longer runs a separate rollover engine.

### Memory migration

On startup, Clawa moves an existing `vault/` tree into `memory/`. Byte-identical target files
merge. Different contents at the same target stop migration visibly without overwriting the
conflict. Inspect both paths before retrying. Custom living documents are not rewritten.

An existing `.pi/clawa-memory.sqlite` is opened read-only. Its rows are exported as Markdown
files containing exact JSON objects in `memory/legacy/`. A row larger than the shared file
reader's limit stops import without truncation. The database remains as a retired source.
Old chat notes and window archives are also retained.

Update custom home instructions to use `clawa_memory` for shared Markdown by default, explicit
`scope: "notes"` for stored chat notes, and `clawa_history` for house archives and revisions.
Generic `notes`, `history`, `new_context`, and `get_context_remaining` are not supplied by Clawa.

### Discord migration

Open each home that should connect and configure its own distinct bot token through the new
`/discord`. The old gateway's `config.env` and `routes.jsonc` are not read or migrated. Old worker
homes, Pi sessions, and `gateway.db` are not deleted. See [Discord](../discord/) for setup and
lifecycle details.

## First restart checks

Start Pi from the recorded main home, not the package checkout or a worker home. Use `pi -c` if
it resumes the intended main session, or `pi -r` to select the recorded session. Slash commands below
are entered in Pi, not a shell. If you cannot operate those controls, ask the user to run them and
report the result. Before considering the upgrade complete:

- Confirm the checkout is detached at `v0.4.0` and the verified target commit, or on `modern`
  at the approved development commit. Confirm the intended Clawa home activated. Do not mark
  a blocked bootstrap as complete by changing its config flag.
- Inspect startup notices and migration errors. A memory collision or failed legacy import is a
  stop condition. Do not overwrite a target, delete the source, or truncate a row to make it pass.
- Confirm `clawa_memory` and `clawa_history` are available. Read a known memory page or retained
  note and inspect the expected prior session history. If legacy memory was present, check its
  migrated files. Use `/memory` to inspect consolidation status without queuing a new job.
- Open `/claw` and check each enabled worker's home and session. Confirm there is no old RPC worker
  or separate panel still running alongside its new tab. Do not delete registry entries or launch
  extra copies to hide an uncertain worker state.
- Reconnect Discord only for the approved homes using the migration steps above. Check connection
  status in each owning tab.

Report the observed commit, resumed session, memory and history checks, and worker state. If a
check fails, stop further work and report the error and affected path without exposing secrets.
Do not claim success for checks you could not perform.

## Roll back

Stop every Pi session using the checkout before changing it. For a previous release tag, use
`git switch --detach vX.Y.Z`. For an earlier modern commit, use its recorded commit ID.

Rollback is safe only when the relevant state is still compatible. Returning to legacy after
memory migration may require restoring the pre-migration home backup as well as package code.
Do not restore over live sessions or assume a retained database reverses the move from `vault/`
to `memory/`.

## Remove the extension

1. Stop the main Pi session and worker tabs using the package.
2. Remove the pi-clawa package path from the home's `.pi/settings.json`. Also remove the Discord
   adapter path if installed.
3. If you installed globally, remove that package entry too. A global install still activates
   configured homes.
4. Start Pi without the package to verify plain-Pi behavior.
5. Delete the checkout when no homes reference it.

Removing the package does **not** delete living documents, worker homes, memory, sessions, Pulse
state, or Discord state. They are your data.
