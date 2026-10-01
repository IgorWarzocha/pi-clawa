import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PulseRuntime } from '../src/pulses/runtime.js'
import { readPulseState } from '../src/pulses/state.js'

const JSON_ERROR_PATTERN = /JSON/
const BETA_DELIVERY_ERROR_PATTERN = /beta delivery failed/u

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
      {} as never,
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
    await pulseRuntime.dispose()
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

test('disposal drains a delivered pulse, checkpoints it, and skips remaining stale deliveries', {
  timeout: 5_000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-pulse-dispose-'))
  let releaseDelivery: () => void = () => {}
  let runtime: PulseRuntime | undefined
  try {
    await mkdir(join(root, '.git'))
    await mkdir(join(root, '.pi'))
    await writeFile(
      join(root, '.pi', 'claw.jsonc'),
      JSON.stringify({ clawas: { workers: [{ id: 'helper', cwd: 'clawas/helper' }] }, clawa: {} }),
    )
    for (const id of ['alpha', 'beta']) {
      await mkdir(join(root, 'clawas', 'helper', 'pulses', id), { recursive: true })
      await writeFile(
        join(root, 'clawas', 'helper', 'pulses', id, 'PULSE.md'),
        ['---', `title: ${id}`, 'schedule: every 1m', '---', '', `# ${id}`].join('\n'),
      )
    }

    let deliveryStarted!: () => void
    const started = new Promise<void>((resolve) => (deliveryStarted = resolve))
    const blocked = new Promise<void>((resolve) => (releaseDelivery = resolve))
    const delivered: string[] = []
    runtime = new PulseRuntime(
      {
        sendMessage: () => {
          throw new Error('unexpected main delivery')
        },
      } as never,
      {
        refreshFromConfig: async () => {},
        getState: () => ({ workers: [] }),
        sendPrompt: async (owner: string) => {
          delivered.push(owner)
          deliveryStarted()
          if (delivered.length === 1) await blocked
        },
      } as never,
    )
    runtime.attach({ cwd: root, hasUI: false, isIdle: () => true } as never)
    await runtime.scanAndRunDue(1_000)
    const scan = runtime.scanAndRunDue(62_000)
    await started
    let stopped = false
    const stopping = runtime.dispose().then(() => (stopped = true))
    await Promise.resolve()
    assert.equal(stopped, false)
    releaseDelivery()
    await Promise.all([scan, stopping])
    assert.deepEqual(delivered, ['helper'])
    assert.equal((await readPulseState(root)).pulses['helper:alpha']?.lastRunAt, 62_000)
    assert.equal((await readPulseState(root)).pulses['helper:beta']?.lastRunAt, undefined)
    runtime.attach({ cwd: root, hasUI: false, isIdle: () => true } as never)
    await runtime.scanAndRunDue(62_000)
    assert.deepEqual(delivered, ['helper', 'helper'])
    await runtime.dispose()
  } finally {
    releaseDelivery()
    await runtime?.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
