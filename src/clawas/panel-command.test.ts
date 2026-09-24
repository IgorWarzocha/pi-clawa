import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_CLAWA_DEFAULTS } from '../config.js'
import { panelArgs, panelEnvironment, shellQuote } from './panel-command.js'

test('native Pi launch keeps session identity and worker reporting without RPC or takeover flags', () => {
  const options = {
    definition: {
      id: 'writer',
      title: 'Writer',
      cwd: '/tmp',
      enabled: true,
      autostart: true,
      fastMode: false,
      reportMode: 'explicit' as const,
    },
    cwd: '/tmp',
    extensionPaths: ['/tmp/ext with space.ts'],
    clawaDefaults: DEFAULT_CLAWA_DEFAULTS,
    projectRoot: '/home/project root',
    sessionFile: '/tmp/worker session.jsonl',
  }
  assert.deepEqual(panelArgs(options), [
    '--session',
    options.sessionFile,
    '--session-dir',
    '/tmp/.pi/sessions',
    '--name',
    'Clawas / Writer',
    '--extension',
    '/tmp/ext with space.ts',
  ])
  const env = panelEnvironment(options)
  assert.equal(env['PI_CLAW_PROJECT_ROOT'], options.projectRoot)
  assert.equal(env['PI_CLAWAS_REPORT_SESSION_ID'], 'main-claw')
  assert.equal(env['PI_CLAWAS_DISCORD_ENABLED'], undefined)
  assert.equal(env['PI_CLAWAS_REPORT_MODE'], 'explicit')
  assert.equal(env['PI_CODEX_FAST'], '0')
  assert.equal(env['PI_CLAWAS_MANUAL_SESSION'], undefined)
  assert.equal(shellQuote("can't $(touch /tmp/nope)"), "'can'\\''t $(touch /tmp/nope)'")
})
