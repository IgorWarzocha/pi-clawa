import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { discoverProjectExtensionPaths, resolveWorkerExtensionPaths } from './extension-paths.js'

test('each worker receives both loaded adapters and its configured extensions without duplicate entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'clawa-extension-paths-'))
  const oldCore = process.env['PI_CLAW_EXTENSION_PATH']
  const oldDiscord = process.env['PI_CLAW_DISCORD_EXTENSION_PATH']
  try {
    const core = join(root, 'core.ts')
    const adapter = join(root, 'adapter.ts')
    const extra = join(root, 'extra.ts')
    for (const path of [core, adapter, extra]) writeFileSync(path, '')
    process.env['PI_CLAW_EXTENSION_PATH'] = core
    process.env['PI_CLAW_DISCORD_EXTENSION_PATH'] = adapter
    const base = discoverProjectExtensionPaths(root)
    const worker = {
      id: 'writer',
      title: 'Writer',
      cwd: root,
      enabled: true,
      autostart: true,
      extensions: ['extra.ts', adapter, 'absent.ts'],
    }
    assert.deepEqual(resolveWorkerExtensionPaths(root, base, worker), [core, adapter, extra])
    process.env['PI_CLAW_DISCORD_EXTENSION_PATH'] = join(root, 'absent.ts')
    assert.deepEqual(discoverProjectExtensionPaths(root), [core])
  } finally {
    if (oldCore === undefined) delete process.env['PI_CLAW_EXTENSION_PATH']
    else process.env['PI_CLAW_EXTENSION_PATH'] = oldCore
    if (oldDiscord === undefined) delete process.env['PI_CLAW_DISCORD_EXTENSION_PATH']
    else process.env['PI_CLAW_DISCORD_EXTENSION_PATH'] = oldDiscord
    rmSync(root, { recursive: true, force: true })
  }
})
