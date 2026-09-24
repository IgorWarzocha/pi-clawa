import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { NestedAgentsSession } from '../src/nested-agents/session.js'

test('worker nested context cannot reload project or worker root instructions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-worker-nested-agents-'))
  try {
    const worker = join(root, 'clawas', 'worker-clawa')
    const topicAgents = join(worker, 'topic', 'AGENTS.md')
    const target = join(worker, 'topic', 'note.md')
    await mkdir(join(root, '.git'))
    await mkdir(join(worker, 'topic'), { recursive: true })
    await writeFile(join(root, 'AGENTS.md'), 'PROJECT ROOT')
    await writeFile(join(worker, 'AGENTS.md'), 'WORKER ROOT')
    await writeFile(topicAgents, 'TOPIC')
    await writeFile(target, 'hello\n')

    const session = new NestedAgentsSession()
    session.reset(worker)

    assert.deepEqual(session.agentsForTargets([target]), [topicAgents])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pulse context cannot load the shared pulses root instructions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-pulse-nested-agents-'))
  try {
    const pulseAgents = join(root, 'pulses', 'hey-clawa', 'AGENTS.md')
    const target = join(root, 'pulses', 'hey-clawa', 'PULSE.md')
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'pulses', 'hey-clawa'), { recursive: true })
    await writeFile(join(root, 'AGENTS.md'), 'ROOT')
    await writeFile(join(root, 'pulses', 'AGENTS.md'), 'PULSES ROOT')
    await writeFile(pulseAgents, 'HEY CLAWA')
    await writeFile(target, '# Hey\n')

    const session = new NestedAgentsSession()
    session.reset(root)

    assert.deepEqual(session.agentsForTargets([target]), [pulseAgents])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
