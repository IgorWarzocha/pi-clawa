import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PulseRuntime } from '../src/pulses/runtime.js'
import {
  isPulseDue,
  isPulseQuietAt,
  parsePulseQuietHours,
  parsePulseSchedule,
} from '../src/pulses/schedule.js'
import { readPulseState } from '../src/pulses/state.js'

const JSON_ERROR_PATTERN = /JSON/
const BETA_DELIVERY_ERROR_PATTERN = /beta delivery failed/u

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

test('successful pulse deliveries stay checkpointed when a later pulse fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-pulse-checkpoint-'))
  try {
    await mkdir(join(root, '.git'))
    for (const id of ['alpha', 'beta']) {
      await mkdir(join(root, 'pulses', id), { recursive: true })
      await writeFile(
        join(root, 'pulses', id, 'PULSE.md'),
        ['---', `title: ${id}`, 'schedule: every 1m', '---', '', `# ${id}`].join('\n'),
        'utf8',
      )
    }

    const delivered: string[] = []
    let failBeta = true
    const pulseRuntime = new PulseRuntime(
      {
        sendMessage: (message: { content?: string }) => {
          const content = message.content ?? ''
          if (failBeta && content.includes('pulses/beta/PULSE.md')) {
            throw new Error('beta delivery failed')
          }
          delivered.push(content)
        },
      } as never,
      stubClawasRuntime() as never,
    )
    pulseRuntime.attach({ cwd: root, hasUI: false, isIdle: () => true } as never)

    await pulseRuntime.scanAndRunDue(1_000)
    await assert.rejects(() => pulseRuntime.scanAndRunDue(62_000), BETA_DELIVERY_ERROR_PATTERN)
    const afterFailure = await readPulseState(root)
    assert.equal(afterFailure.pulses['main:alpha']?.lastRunAt, 62_000)
    assert.equal(afterFailure.pulses['main:beta']?.lastRunAt, undefined)

    failBeta = false
    await pulseRuntime.scanAndRunDue(62_000)
    assert.equal(delivered.length, 2)
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

test('Hey Clawa defers when another pulse for the same owner is due', async () => {
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

    let deliveries = 0
    const pulseRuntime = new PulseRuntime(
      { sendMessage: () => (deliveries += 1) } as never,
      stubClawasRuntime() as never,
    )
    pulseRuntime.attach({ cwd: root, hasUI: false, isIdle: () => true } as never)

    await pulseRuntime.scanAndRunDue(1_000)
    await pulseRuntime.scanAndRunDue(62_000)

    assert.equal(deliveries, 1)
    const deferredState = await readPulseState(root)
    assert.equal(deferredState.pulses['main:exact-check']?.lastRunAt, 62_000)
    assert.equal(deferredState.pulses['main:hey-clawa']?.deferUntil, 962_000)

    await pulseRuntime.scanAndRunDue(962_000)
    assert.equal(deliveries, 2)
    assert.equal((await readPulseState(root)).pulses['main:hey-clawa']?.lastRunAt, 962_000)
    pulseRuntime.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
