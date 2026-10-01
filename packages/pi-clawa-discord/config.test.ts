import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadConfig, writeConfigValue } from './src/config.js'
import { acquireBotConnection } from './src/discord/connection-lease.js'

const CONNECTED = /already connected/u

test('each home owns its token and policy, ignoring parent and process config', () => {
  const root = mkdtempSync(join(tmpdir(), 'clawa-bot-homes-'))
  const previous = process.env['DISCORD_BOT_TOKEN']
  process.env['DISCORD_BOT_TOKEN'] = 'inherited-token'
  try {
    const parent = loadConfig(root)
    const home = join(root, 'clawas', 'friend')
    writeConfigValue(parent.configPath, 'DISCORD_BOT_TOKEN', 'parent-token')
    writeConfigValue(parent.configPath, 'CHANNEL_POLICY', 'all')
    const child = loadConfig(home)
    assert.equal(child.token, '')
    assert.equal(child.channelPolicy, 'mentions')
    assert.equal(child.ambientWakeEnabled, false)
    assert.equal(child.projectRoot, home)
    assert.notEqual(child.assetsDir, parent.assetsDir)
    assert.equal(statSync(child.configPath).mode & 0o777, 0o600)
    writeConfigValue(child.configPath, 'DISCORD_BOT_TOKEN', 'child-token')
    assert.equal(loadConfig(root).token, 'parent-token')
    assert.equal(loadConfig(home).token, 'child-token')
  } finally {
    if (previous === undefined) delete process.env['DISCORD_BOT_TOKEN']
    else process.env['DISCORD_BOT_TOKEN'] = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test('token leases exclude other sessions, release on exit, and do not block another bot', () => {
  const root = mkdtempSync(join(tmpdir(), 'clawa-bot-leases-'))
  const previous = process.env['TMPDIR']
  process.env['TMPDIR'] = root
  const token = randomUUID()
  const other = acquireBotConnection(randomUUID())
  let release = acquireBotConnection(token)
  const entry = new URL('./src/discord/connection-lease.ts', import.meta.url).href
  const child = (code: string) =>
    spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `import { acquireBotConnection } from ${JSON.stringify(entry)}; ${code}`,
      ],
      { encoding: 'utf8', timeout: 10_000 },
    )
  try {
    assert.throws(() => acquireBotConnection(token), CONNECTED)
    const blocked = child(
      `try { acquireBotConnection(${JSON.stringify(token)}); process.exit(2) } catch (error) { if (!error.message.includes('already connected')) throw error }`,
    )
    assert.equal(blocked.status, 0, blocked.stderr)
    release()
    release()
    // Exit without calling release: the OS, not a stale PID-file cleanup, frees the lease.
    const exited = child(`acquireBotConnection(${JSON.stringify(token)}); process.exit(0)`)
    assert.equal(exited.status, 0, exited.stderr)
    release = acquireBotConnection(token)
  } finally {
    release()
    other()
    if (previous === undefined) delete process.env['TMPDIR']
    else process.env['TMPDIR'] = previous
    rmSync(root, { recursive: true, force: true })
  }
})
