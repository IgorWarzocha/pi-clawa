import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { discoverPulseDefinitions } from './pulses/definitions.js'
import { CLAWA_PULSE_MESSAGE_TYPE } from './pulses/message.js'
import { PulseRuntime } from './pulses/runtime.js'
import { isPulseDue, parsePulseSchedule } from './pulses/schedule.js'

const TINY_CHECK_FILE_PATTERN = /Definition file: pulses\/tiny-check.md/
const TINY_CHECK_STATE_PATTERN = /tiny-check/

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
})

test('pulse runtime dispatches due main-home pulse as custom message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-pulse-'))
  try {
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'pulses'), { recursive: true })
    await writeFile(join(root, 'pulses', 'AGENTS.md'), '# pulse journal\n', 'utf8')
    await writeFile(
      join(root, 'pulses', 'tiny-check.md'),
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

    const definitions = await discoverPulseDefinitions(root)
    assert.equal(definitions.length, 1)
    assert.equal(definitions[0]?.key, 'main:tiny-check')

    const messages: Array<{ customType?: string; content?: string; details?: unknown }> = []
    const pulseRuntime = new PulseRuntime(
      {
        sendMessage: (message: { customType?: string; content?: string; details?: unknown }) => {
          messages.push(message)
        },
      } as never,
      stubClawasRuntime() as never,
    )
    pulseRuntime.attach({ cwd: root, hasUI: false, isIdle: () => true } as never)

    await pulseRuntime.scanAndRunDue(1_000)
    assert.equal(messages.length, 0)
    await pulseRuntime.scanAndRunDue(62_000)

    assert.equal(messages.length, 1)
    assert.equal(messages[0]?.customType, CLAWA_PULSE_MESSAGE_TYPE)
    assert.match(messages[0]?.content ?? '', TINY_CHECK_FILE_PATTERN)
    assert.match(
      await readFile(join(root, '.pi', 'pulses', 'state.json'), 'utf8'),
      TINY_CHECK_STATE_PATTERN,
    )
    pulseRuntime.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
