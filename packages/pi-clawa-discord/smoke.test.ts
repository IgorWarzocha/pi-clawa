import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import clawDiscord from './index.js'
import { parseFinalRoutes } from './src/gateway/agent/final-routes.js'

const TOKEN_ENV_PATTERN = /DISCORD_BOT_TOKEN=/
const DEFAULT_DM_ROUTE_PATTERN = /"channel": "dm"/
const DISCORD_WORKER_PATTERN = /"id": "discord-clawa"/
const DISCORD_AGENTS_PATTERN = /Discord/
const SHARED_CLAWAS_LINK_TARGET = '../../CLAWAS.md'
const SHARED_HUMAN_LINK_TARGET = '../../HUMAN.md'

type Handler = (event: unknown, ctx: any) => unknown

function withCleanDiscordEnv<T>(run: () => Promise<T>): Promise<T> {
  const previous = {
    PI_CLAWAS_DISCORD_ENABLED: process.env['PI_CLAWAS_DISCORD_ENABLED'],
    PI_CLAWAS_ROLE: process.env['PI_CLAWAS_ROLE'],
    DISCORD_BOT_TOKEN: process.env['DISCORD_BOT_TOKEN'],
    PI_CLAWA_DISCORD_CONFIG: process.env['PI_CLAWA_DISCORD_CONFIG'],
    PI_CLAW_PROJECT_ROOT: process.env['PI_CLAW_PROJECT_ROOT'],
    PI_CWD: process.env['PI_CWD'],
  }

  delete process.env['PI_CLAWAS_DISCORD_ENABLED']
  delete process.env['PI_CLAWAS_ROLE']
  delete process.env['DISCORD_BOT_TOKEN']
  delete process.env['PI_CLAWA_DISCORD_CONFIG']
  delete process.env['PI_CLAW_PROJECT_ROOT']
  delete process.env['PI_CWD']

  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

test('Discord adapter first session creates tokenless config and worker without starting gateway', async () => {
  await withCleanDiscordEnv(async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawa-discord-smoke-'))
    try {
      await mkdir(join(root, '.git'))
      const commands = new Map<string, unknown>()
      const handlers = new Map<string, Handler>()
      const notifications: string[] = []
      const pi = {
        registerCommand: (name: string, command: unknown) => commands.set(name, command),
        registerTool: () => assert.fail('tokenless main adapter should not register worker tool'),
        on: (event: string, handler: Handler) => handlers.set(event, handler),
        sendUserMessage: () => undefined,
      }

      clawDiscord(pi as any)
      assert.ok(commands.has('discord'))
      assert.ok(handlers.has('session_start'))
      assert.ok(handlers.has('session_shutdown'))

      await handlers.get('session_start')?.(
        {},
        {
          cwd: root,
          hasUI: true,
          ui: { notify: (message: string) => notifications.push(message) },
        },
      )

      const env = await readFile(join(root, '.pi', 'clawa-discord', 'config.env'), 'utf8')
      const routes = await readFile(join(root, '.pi', 'clawa-discord', 'routes.jsonc'), 'utf8')
      const workers = await readFile(join(root, '.pi', 'claw.jsonc'), 'utf8')
      const agents = await readFile(join(root, 'clawas', 'discord-clawa', 'AGENTS.md'), 'utf8')
      const humanLink = await readlink(join(root, 'clawas', 'discord-clawa', 'HUMAN.md'))
      const clawasLink = await readlink(join(root, 'clawas', 'discord-clawa', 'CLAWAS.md'))

      assert.match(env, TOKEN_ENV_PATTERN)
      assert.match(routes, DEFAULT_DM_ROUTE_PATTERN)
      assert.match(workers, DISCORD_WORKER_PATTERN)
      assert.match(agents, DISCORD_AGENTS_PATTERN)
      assert.equal(humanLink, SHARED_HUMAN_LINK_TARGET)
      assert.equal(clawasLink, SHARED_CLAWAS_LINK_TARGET)
      assert.ok(notifications.some((message) => message.includes('add DISCORD_BOT_TOKEN')))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

test('Discord final routing blocks parse explicit destinations', () => {
  const routed = parseFinalRoutes(
    [
      'ignored preface',
      '[react m1: 🫡]',
      '[#howaclawa]: public note',
      'continued',
      '[dm]: private note',
      '[main_clawa]: ask main',
      '[quiet]',
    ].join('\n'),
  )

  assert.equal(routed.hasRoutes, true)
  assert.deepEqual(routed.blocks, [
    {
      target: { kind: 'channel', label: '#howaclawa' },
      text: '[react m1: 🫡]\npublic note\ncontinued',
    },
    { target: { kind: 'dm' }, text: 'private note' },
    { target: { kind: 'main-clawa' }, text: 'ask main' },
    { target: { kind: 'quiet' }, text: '' },
  ])
})
