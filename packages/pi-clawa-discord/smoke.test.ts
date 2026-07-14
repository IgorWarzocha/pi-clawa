import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import clawDiscord from './index.js'
import { adapterEntryPath } from './src/extension/constants.js'
import { stopGateway } from './src/extension/gateway.js'
import { getGatewayProcess, setGatewayProcess } from './src/extension/gateway-state.js'
import { parseFinalRoutes } from './src/gateway/agent/final-routes.js'
import { runSchemaMigrations } from './src/gateway/db/schema.js'
import { validateDiscordDeliveryRequest } from './src/gateway/delivery-types.js'
import { stripAcceptedTrigger } from './src/gateway/discord/policy.js'
import { sanitizeDiscordLabel, sanitizeDiscordText } from './src/gateway/discord/sanitize.js'

const TOKEN_ENV_PATTERN = /DISCORD_BOT_TOKEN=/
const DEFAULT_DM_ROUTE_PATTERN = /"channel": "dm"/
const DISCORD_WORKER_PATTERN = /"id": "discord-clawa"/
const DISCORD_AGENTS_PATTERN = /Discord/
const PRIMARY_TRIGGER_PATTERN = /^@pi\b/iu
const TRIGGER_ALIAS_PATTERN = /\b(?:claw\w*|clawa\w*)\b/iu
const SHARED_CLAWAS_LINK_TARGET = '../../CLAWAS.md'
const SHARED_HUMAN_LINK_TARGET = '../../HUMAN.md'
const CARD_POLL_CONFLICT_PATTERN = /cards and polls are separate message modes/

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

      const configPath = join(root, '.pi', 'claw.jsonc')
      const config = JSON.parse(workers)
      const discordWorker = config.clawas.workers.find(
        (worker: { id: string }) => worker.id === 'discord-clawa',
      )
      const adapterLink = join(root, '.pi', 'adapter-link.ts')
      await symlink(adapterEntryPath, adapterLink)
      discordWorker.extensions = [adapterLink]
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
      await writeFile(join(root, 'clawas', 'discord-clawa', 'AGENTS.md'), 'custom lane\n')

      await handlers.get('session_start')?.(
        {},
        {
          cwd: root,
          hasUI: true,
          ui: { notify: (message: string) => notifications.push(message) },
        },
      )

      const restartedConfig = JSON.parse(await readFile(configPath, 'utf8'))
      const restartedWorker = restartedConfig.clawas.workers.find(
        (worker: { id: string }) => worker.id === 'discord-clawa',
      )
      assert.deepEqual(restartedWorker.extensions, [adapterLink])
      assert.equal(
        await readFile(join(root, 'clawas', 'discord-clawa', 'AGENTS.md'), 'utf8'),
        'custom lane\n',
      )
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

test('Discord input sanitizer strips hidden controls without mangling normal text', () => {
  assert.equal(
    sanitizeDiscordText('hej\u200b clawa\u202e\nemoji 👨‍💻 café\r\n\u0000done'),
    'hej clawa\nemoji 👨‍💻 café\ndone',
  )
  assert.equal(sanitizeDiscordLabel('Igor\n\u202eWarzocha'), 'Igor Warzocha')
})

test('Discord trigger aliases are removed from accepted worker prompts', () => {
  assert.equal(
    stripAcceptedTrigger('@pi hello there', {
      triggerPattern: PRIMARY_TRIGGER_PATTERN,
      triggerAliasPattern: TRIGGER_ALIAS_PATTERN,
    }),
    'hello there',
  )
  assert.equal(
    stripAcceptedTrigger('hey clawa can you look?', {
      triggerPattern: PRIMARY_TRIGGER_PATTERN,
      triggerAliasPattern: TRIGGER_ALIAS_PATTERN,
      stripAlias: true,
    }),
    'hey can you look?',
  )
  assert.equal(
    stripAcceptedTrigger('clawa is already in this open-channel sentence', {
      triggerPattern: PRIMARY_TRIGGER_PATTERN,
      triggerAliasPattern: TRIGGER_ALIAS_PATTERN,
    }),
    'clawa is already in this open-channel sentence',
  )
})

test('Discord gateway stop waits for the managed child to exit', async () => {
  const child = new EventEmitter() as EventEmitter & {
    exitCode: number | null
    signalCode: NodeJS.Signals | null
    killed: boolean
    kill: (signal: NodeJS.Signals) => boolean
  }
  child.exitCode = null
  child.signalCode = null
  child.killed = false
  child.kill = (signal) => {
    child.killed = true
    setImmediate(() => {
      child.signalCode = signal
      child.emit('exit', null, signal)
    })
    return true
  }

  setGatewayProcess(child as never)
  const stopping = stopGateway()
  assert.equal(getGatewayProcess(), child)
  await stopping
  assert.equal(getGatewayProcess(), null)
})

test('Discord schema rejects duplicate source messages at durable boundaries', () => {
  const db = new Database(':memory:')
  try {
    db.exec(`
      create table message_queue (
        rowid integer primary key autoincrement,
        channel_jid text not null,
        sender text not null,
        sender_name text not null,
        source_message_id text,
        log_rowid integer,
        content text not null,
        timestamp text not null,
        status text not null default 'pending',
        created_at text not null default (datetime('now')),
        processed_at text
      );
      create table message_log (
        rowid integer primary key autoincrement,
        channel_jid text not null,
        role text not null,
        source_message_id text,
        content text not null,
        timestamp text not null default (datetime('now'))
      );
      insert into message_log
        (channel_jid, role, source_message_id, content)
      values
        ('dc:one', 'user', 'old-message', 'first'),
        ('dc:one', 'user', 'old-message', 'duplicate');
      insert into message_queue
        (channel_jid, sender, sender_name, source_message_id, log_rowid, content, timestamp, status)
      values
        ('dc:one', 'human', 'Human', 'old-message', 1, 'failed old delivery', datetime('now'), 'failed'),
        ('dc:one', 'human', 'Human', 'old-message', 2, 'pending replay', datetime('now'), 'pending');
    `)
    runSchemaMigrations(db)
    const queueColumns = db.prepare('pragma table_info(message_queue)').all() as Array<{
      name: string
    }>
    assert.ok(queueColumns.some((column) => column.name === 'reply_to_message_id'))
    assert.ok(
      db
        .prepare(
          "select 1 from sqlite_master where type = 'table' and name = 'discord_delivery_queue'",
        )
        .get(),
    )
    assert.ok(
      db
        .prepare(
          "select 1 from sqlite_master where type = 'table' and name = 'discord_interactions'",
        )
        .get(),
    )
    assert.equal(
      (db.prepare('select count(*) as count from message_queue').get() as { count: number }).count,
      1,
    )
    assert.equal(
      (db.prepare('select count(*) as count from message_log').get() as { count: number }).count,
      1,
    )
    assert.deepEqual(db.prepare('select content, log_rowid from message_queue').get(), {
      content: 'pending replay',
      log_rowid: 1,
    })

    const queueInsert = db.prepare(`
      insert into message_queue
        (channel_jid, sender, sender_name, source_message_id, content, timestamp)
      values (?, ?, ?, ?, ?, ?)
    `)
    queueInsert.run('dc:one', 'human', 'Human', 'message-1', 'hello', new Date().toISOString())
    assert.throws(() =>
      queueInsert.run(
        'dc:one',
        'human',
        'Human',
        'message-1',
        'hello again',
        new Date().toISOString(),
      ),
    )

    const logInsert = db.prepare(`
      insert into message_log
        (channel_jid, role, sender_id, sender_name, source_message_id, content)
      values (?, ?, ?, ?, ?, ?)
    `)
    logInsert.run('dc:one', 'user', 'human', 'Human', 'message-1', 'hello')
    assert.throws(() =>
      logInsert.run('dc:one', 'user', 'human', 'Human', 'message-1', 'hello again'),
    )
  } finally {
    db.close()
  }
})

test('Discord rich delivery validation keeps incompatible message modes explicit', () => {
  const fileStat = () => ({ size: 512 })
  assert.doesNotThrow(() =>
    validateDiscordDeliveryRequest(
      {
        channelJid: 'dc:one',
        title: 'A useful picture',
        card: true,
        files: [{ path: '/house/result.png', description: 'A purple chart' }],
        actions: [{ label: 'Dig deeper', prompt: 'Please dig deeper.' }],
        select: {
          placeholder: 'Choose one',
          options: [
            { label: 'Quick', prompt: 'Do the quick pass.' },
            { label: 'Deep', prompt: 'Do the deep pass.' },
          ],
        },
      },
      { maxAttachmentBytes: 1024, maxTotalAttachmentBytes: 2048, fileStat },
    ),
  )

  assert.throws(
    () =>
      validateDiscordDeliveryRequest(
        {
          channelJid: 'dc:one',
          card: true,
          files: [],
          poll: { question: 'Which?', answers: ['A', 'B'] },
        },
        { maxAttachmentBytes: 1024, maxTotalAttachmentBytes: 2048, fileStat },
      ),
    CARD_POLL_CONFLICT_PATTERN,
  )
})
