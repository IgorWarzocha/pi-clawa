import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { discoverPulseCatalog, discoverPulseDefinitions } from '../src/pulses/definitions.js'
import { CLAWA_PULSE_MESSAGE_TYPE } from '../src/pulses/message.js'
import { PulseRuntime } from '../src/pulses/runtime.js'
import {
  isPulseDue,
  isPulseQuietAt,
  parsePulseQuietHours,
  parsePulseSchedule,
} from '../src/pulses/schedule.js'
import { readPulseState } from '../src/pulses/state.js'

const TINY_CHECK_FILE_PATTERN = /Definition file: .*pulses\/tiny-check\/PULSE.md/
const TINY_CHECK_STATE_PATTERN = /tiny-check/
const MANUAL_PULSE_FILE_PATTERN = /Definition file: pulses\/manual-note\/PULSE.md/
const MANUAL_PULSE_STATE_PATTERN = /manual-note/
const EXACT_CHECK_FILE_PATTERN = /exact-check\/PULSE.md/
const HEY_CLAWA_FILE_PATTERN = /hey-clawa\/PULSE.md/
const HEY_CLAWA_STATE_PATTERN = /"main:hey-clawa"/
const HEY_CLAWA_DEFER_PATTERN = /"deferUntil": 962000/
const JSON_ERROR_PATTERN = /JSON/
const WAKE_TIME_PATTERN =
  /Wake time: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC[+-]\d{2}:\d{2} \([^)]+\)/u
const QUIET_HOURS_PATTERN = /Quiet hours: 23:00-08:00 local time/u
const MANUAL_QUIET_BYPASS_PATTERN = /Quiet hours: 23:00-08:00 local time \(manual run-now bypass\)/u

function stubClawasRuntime() {
  return {
    refreshFromConfig: async () => {},
    getState: () => ({ workers: [] }),
    getWorkerDefinition: () => {
      throw new Error('unexpected worker pulse')
    },
    ensureWorkerRunning: async () => {},
    getClawaDefaults: () => ({ mainClawName: 'Clawa' }),
  }
}

test('pulse schedules parse and skip first-seen interval runs', () => {
  const schedule = parsePulseSchedule('every 30m')
  assert.deepEqual(schedule, { kind: 'interval', everyMs: 1_800_000 })
  assert.deepEqual(isPulseDue({ schedule: schedule!, nowMs: 10_000, firstSeenAt: undefined }), {
    due: false,
    dueKey: null,
  })
  assert.equal(isPulseDue({ schedule: schedule!, nowMs: 1_810_000, firstSeenAt: 10_000 }).due, true)
  assert.deepEqual(parsePulseSchedule('manual'), { kind: 'manual' })
  assert.equal(parsePulseSchedule(''), null)
  assert.deepEqual(isPulseDue({ schedule: { kind: 'manual' }, nowMs: 10_000 }), {
    due: false,
    dueKey: null,
  })
})

test('pulse quiet hours parse local daytime and overnight windows', () => {
  const overnight = parsePulseQuietHours('23:00-08:00')
  const daytime = parsePulseQuietHours('13:00 - 14:00')
  assert.deepEqual(overnight, { startMinute: 1380, endMinute: 480 })
  assert.deepEqual(daytime, { startMinute: 780, endMinute: 840 })
  assert.equal(isPulseQuietAt(overnight!, new Date(2026, 6, 18, 23, 0).getTime()), true)
  assert.equal(isPulseQuietAt(overnight!, new Date(2026, 6, 19, 7, 59).getTime()), true)
  assert.equal(isPulseQuietAt(overnight!, new Date(2026, 6, 19, 8, 0).getTime()), false)
  assert.equal(isPulseQuietAt(daytime!, new Date(2026, 6, 18, 13, 30).getTime()), true)
  assert.equal(parsePulseQuietHours('24:00-08:00'), null)
  assert.equal(parsePulseQuietHours('08:00-08:00'), null)
})

test('pulse runtime dispatches due main-home pulse as custom message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-pulse-'))
  try {
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'pulses'), { recursive: true })
    await writeFile(join(root, 'pulses', 'AGENTS.md'), '# pulse journal\n', 'utf8')
    await writeFile(join(root, 'pulses', 'loose-note.md'), '# loose note\n', 'utf8')
    await mkdir(join(root, 'pulses', 'tiny-check'), { recursive: true })
    await writeFile(
      join(root, 'pulses', 'tiny-check', 'PULSE.md'),
      [
        '---',
        'title: Tiny check',
        'schedule: every 1m',
        'enabled: true',
        '---',
        '',
        '# Tiny check',
      ].join('\n'),
      'utf8',
    )
    await mkdir(join(root, 'pulses', 'manual-note'), { recursive: true })
    await writeFile(
      join(root, 'pulses', 'manual-note', 'PULSE.md'),
      [
        '---',
        'title: Manual note',
        'schedule: manual',
        'enabled: true',
        '---',
        '',
        '# Manual note',
      ].join('\n'),
      'utf8',
    )
    await mkdir(join(root, 'pulses', 'curiosity-poke'), { recursive: true })
    await writeFile(
      join(root, 'pulses', 'curiosity-poke', 'PULSE.md'),
      ['---', 'title: Curiosity poke', 'enabled: true', '---', '', '# Curiosity poke'].join('\n'),
      'utf8',
    )
    await mkdir(join(root, 'pulses', 'curiosity-poke', '2026-06'), { recursive: true })
    await writeFile(
      join(root, 'pulses', 'curiosity-poke', '2026-06', 'run-note.md'),
      '# run note\n',
      'utf8',
    )

    const definitions = await discoverPulseDefinitions(root)
    const catalog = await discoverPulseCatalog(root)
    assert.equal(definitions.length, 2)
    assert.equal(catalog.length, 3)
    assert.equal(
      definitions.find((definition) => definition.id === 'tiny-check')?.key,
      'main:tiny-check',
    )
    assert.equal(
      catalog.find((definition) => definition.id === 'curiosity-poke')?.status,
      'invalid',
    )
    assert.deepEqual(definitions.find((definition) => definition.id === 'manual-note')?.schedule, {
      kind: 'manual',
    })
    assert.equal(
      definitions.some((definition) => definition.id === 'curiosity-poke'),
      false,
    )
    assert.equal(
      definitions.some((definition) => definition.id === 'loose-note'),
      false,
    )

    const messages: Array<{
      customType?: string
      content?: string
      details?: unknown
      options?: unknown
    }> = []
    let releaseCompaction: (ready: boolean) => void = () => {}
    const compactionReady = new Promise<boolean>((resolve) => {
      releaseCompaction = resolve
    })
    const pulseRuntime = new PulseRuntime(
      {
        sendMessage: (
          message: { customType?: string; content?: string; details?: unknown },
          options?: unknown,
        ) => messages.push({ ...message, options }),
      } as never,
      stubClawasRuntime() as never,
      undefined,
      () => compactionReady,
    )
    pulseRuntime.attach({ cwd: root, hasUI: false, isIdle: () => true } as never)

    await pulseRuntime.scanAndRunDue(1_000)
    assert.equal(messages.length, 0)
    const dueScan = pulseRuntime.scanAndRunDue(62_000)
    await Promise.resolve()
    assert.equal(messages.length, 0)
    releaseCompaction(true)
    await dueScan

    assert.equal(messages.length, 1)
    assert.equal(messages[0]?.customType, CLAWA_PULSE_MESSAGE_TYPE)
    assert.match(messages[0]?.content ?? '', TINY_CHECK_FILE_PATTERN)
    assert.match(messages[0]?.content ?? '', WAKE_TIME_PATTERN)
    assert.match(await readFile(join(root, '.pi', 'pulses.json'), 'utf8'), TINY_CHECK_STATE_PATTERN)
    assert.doesNotMatch(
      await readFile(join(root, '.pi', 'pulses.json'), 'utf8'),
      MANUAL_PULSE_STATE_PATTERN,
    )

    await pulseRuntime.runNow('manual-note')
    assert.equal(messages.length, 2)
    assert.match(messages[1]?.content ?? '', MANUAL_PULSE_FILE_PATTERN)
    pulseRuntime.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('scheduled pulses sleep through quiet hours and run once awake', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-pulse-quiet-'))
  try {
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'pulses', 'night-sleeper'), { recursive: true })
    await writeFile(
      join(root, 'pulses', 'night-sleeper', 'PULSE.md'),
      [
        '---',
        'title: Night sleeper',
        'schedule: daily 23:30',
        'quietHours: 23:00-08:00',
        'enabled: true',
        '---',
        '',
        '# Night sleeper',
      ].join('\n'),
      'utf8',
    )

    const definitions = await discoverPulseDefinitions(root)
    assert.equal(definitions[0]?.quietHoursText, '23:00-08:00')
    const messages: string[] = []
    const pulseRuntime = new PulseRuntime(
      {
        sendMessage: (message: { content?: string }) => messages.push(message.content ?? ''),
      } as never,
      stubClawasRuntime() as never,
    )
    pulseRuntime.attach({ cwd: root, hasUI: false, isIdle: () => true } as never)

    const beforeQuiet = new Date(2026, 6, 18, 10, 0).getTime()
    const duringQuiet = new Date(2026, 6, 18, 23, 31).getTime()
    const afterQuiet = new Date(2026, 6, 19, 8, 0).getTime()
    await pulseRuntime.scanAndRunDue(beforeQuiet)
    await pulseRuntime.scanAndRunDue(duringQuiet)
    assert.equal(messages.length, 0)

    await pulseRuntime.scanAndRunDue(afterQuiet)
    assert.equal(messages.length, 1)
    assert.match(messages[0] ?? '', QUIET_HOURS_PATTERN)
    assert.match(messages[0] ?? '', WAKE_TIME_PATTERN)

    await pulseRuntime.runNow('night-sleeper')
    assert.equal(messages.length, 2)
    assert.match(messages[1] ?? '', MANUAL_QUIET_BYPASS_PATTERN)
    pulseRuntime.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pulse state corruption fails instead of resetting scheduler history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-pulse-state-corrupt-'))
  try {
    await mkdir(join(root, '.git'))
    await mkdir(join(root, '.pi'), { recursive: true })
    await writeFile(join(root, '.pi', 'pulses.json'), '{ nope', 'utf8')

    await assert.rejects(() => readPulseState(root), JSON_ERROR_PATTERN)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pulse runtime queues main pulse as follow-up while main Clawa is busy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-pulse-busy-main-'))
  try {
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'pulses', 'tiny-check'), { recursive: true })
    await writeFile(
      join(root, 'pulses', 'tiny-check', 'PULSE.md'),
      [
        '---',
        'title: Tiny check',
        'schedule: every 1m',
        'enabled: true',
        '---',
        '',
        '# Tiny check',
      ].join('\n'),
      'utf8',
    )

    const messages: Array<{
      content: string
      options: { deliverAs?: string; triggerTurn?: boolean } | undefined
    }> = []
    const pulseRuntime = new PulseRuntime(
      {
        sendMessage: (
          message: { content?: string },
          options?: { deliverAs?: string; triggerTurn?: boolean },
        ) => messages.push({ content: message.content ?? '', options }),
      } as never,
      stubClawasRuntime() as never,
    )
    pulseRuntime.attach({ cwd: root, hasUI: false, isIdle: () => false } as never)

    await pulseRuntime.scanAndRunDue(1_000)
    await pulseRuntime.scanAndRunDue(62_000)

    assert.deepEqual(messages[0]?.options, { triggerTurn: true, deliverAs: 'followUp' })
    assert.match(messages[0]?.content ?? '', TINY_CHECK_FILE_PATTERN)
    pulseRuntime.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pulse runtime delays Hey Clawa when another same-owner pulse is due', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-pulse-hey-collision-'))
  try {
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'pulses', 'hey-clawa'), { recursive: true })
    await mkdir(join(root, 'pulses', 'exact-check'), { recursive: true })
    await writeFile(
      join(root, 'pulses', 'hey-clawa', 'PULSE.md'),
      ['---', 'title: Hey, Clawa', 'schedule: every 1m', 'enabled: true', '---', '', '# Hey'].join(
        '\n',
      ),
      'utf8',
    )
    await writeFile(
      join(root, 'pulses', 'exact-check', 'PULSE.md'),
      [
        '---',
        'title: Exact check',
        'schedule: at 1970-01-01T00:01:02.000Z',
        'enabled: true',
        '---',
        '',
        '# Exact check',
      ].join('\n'),
      'utf8',
    )

    const messages: string[] = []
    const pulseRuntime = new PulseRuntime(
      {
        sendMessage: (message: { content?: string }) => messages.push(message.content ?? ''),
      } as never,
      stubClawasRuntime() as never,
    )
    pulseRuntime.attach({ cwd: root, hasUI: false, isIdle: () => true } as never)

    await pulseRuntime.scanAndRunDue(1_000)
    await pulseRuntime.scanAndRunDue(62_000)

    assert.equal(messages.length, 1)
    assert.match(messages[0] ?? '', EXACT_CHECK_FILE_PATTERN)
    const deferredState = await readFile(join(root, '.pi', 'pulses.json'), 'utf8')
    assert.match(deferredState, HEY_CLAWA_STATE_PATTERN)
    assert.match(deferredState, HEY_CLAWA_DEFER_PATTERN)

    await pulseRuntime.scanAndRunDue(962_000)

    assert.equal(messages.length, 2)
    assert.match(messages[1] ?? '', HEY_CLAWA_FILE_PATTERN)
    pulseRuntime.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pulse runtime queues worker pulse as follow-up while worker is busy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-pulse-busy-worker-'))
  try {
    const workerHome = join(root, 'clawas', 'researcher')
    await mkdir(join(root, '.git'))
    await mkdir(join(root, '.pi'), { recursive: true })
    await mkdir(join(workerHome, 'pulses', 'tiny-check'), { recursive: true })
    await writeFile(
      join(root, '.pi', 'claw.jsonc'),
      JSON.stringify({
        bootstrapped: true,
        clawas: {
          baseDir: 'clawas',
          tmuxSession: 'clawas',
          workers: [
            { id: 'researcher', title: 'Researcher', cwd: 'clawas/researcher', autostart: true },
          ],
        },
      }),
      'utf8',
    )
    await writeFile(
      join(workerHome, 'pulses', 'tiny-check', 'PULSE.md'),
      [
        '---',
        'title: Tiny check',
        'schedule: every 1m',
        'enabled: true',
        '---',
        '',
        '# Tiny check',
      ].join('\n'),
      'utf8',
    )

    const prompts: Array<{ workerId: string; message: string; mode: string }> = []
    const clawasRuntime = {
      refreshFromConfig: async () => {},
      getState: () => ({
        workers: [
          {
            definition: { id: 'researcher', title: 'Researcher', cwd: 'clawas/researcher' },
            status: 'streaming',
            manualSession: false,
          },
        ],
      }),
      sendPrompt: async (workerId: string, message: string, mode: string) => {
        prompts.push({ workerId, message, mode })
      },
    }
    const pulseRuntime = new PulseRuntime(
      { sendMessage: () => {} } as never,
      clawasRuntime as never,
    )
    pulseRuntime.attach({ cwd: root, hasUI: false, isIdle: () => true } as never)

    await pulseRuntime.scanAndRunDue(1_000)
    await pulseRuntime.scanAndRunDue(62_000)

    assert.equal(prompts[0]?.workerId, 'researcher')
    assert.equal(prompts[0]?.mode, 'followUp')
    assert.match(prompts[0]?.message ?? '', TINY_CHECK_FILE_PATTERN)
    pulseRuntime.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pulse runtime queues manual-session worker pulses through the session socket', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-pulse-manual-worker-'))
  try {
    const workerHome = join(root, 'clawas', 'researcher')
    await mkdir(join(root, '.git'))
    await mkdir(join(root, '.pi'), { recursive: true })
    await mkdir(join(workerHome, 'pulses', 'tiny-check'), { recursive: true })
    await writeFile(
      join(root, '.pi', 'claw.jsonc'),
      JSON.stringify({
        bootstrapped: true,
        clawas: {
          baseDir: 'clawas',
          tmuxSession: 'clawas',
          workers: [
            { id: 'researcher', title: 'Researcher', cwd: 'clawas/researcher', autostart: true },
          ],
        },
      }),
      'utf8',
    )
    await writeFile(
      join(workerHome, 'pulses', 'tiny-check', 'PULSE.md'),
      [
        '---',
        'title: Tiny check',
        'schedule: every 1m',
        'enabled: true',
        '---',
        '',
        '# Tiny check',
      ].join('\n'),
      'utf8',
    )

    const prompts: unknown[] = []
    const sessionMessages: Array<{ target: string; options: { message: string; mode?: string } }> =
      []
    const clawasRuntime = {
      refreshFromConfig: async () => {},
      getState: () => ({
        workers: [
          {
            definition: { id: 'researcher', title: 'Researcher', cwd: 'clawas/researcher' },
            status: 'stopped',
            manualSession: true,
          },
        ],
      }),
      sendPrompt: async (...args: unknown[]) => {
        prompts.push(args)
      },
    }
    const pulseRuntime = new PulseRuntime(
      { sendMessage: () => {} } as never,
      clawasRuntime as never,
      async (target, options) => {
        sessionMessages.push({ target, options })
      },
    )
    pulseRuntime.attach({ cwd: root, hasUI: false, isIdle: () => true } as never)

    await pulseRuntime.scanAndRunDue(1_000)
    await pulseRuntime.scanAndRunDue(62_000)

    assert.equal(prompts.length, 0)
    assert.equal(sessionMessages[0]?.target, 'researcher')
    assert.equal(sessionMessages[0]?.options.mode, 'followUp')
    assert.match(sessionMessages[0]?.options.message ?? '', TINY_CHECK_FILE_PATTERN)
    pulseRuntime.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
