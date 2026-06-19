import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildHydrationSystemPrompt, loadHydrationFiles } from './hydrate.js'

test('hydration loads active continuity files and excludes deprecated HEARTBEAT', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'howaboua-hydrate-'))
  try {
    for (const name of ['CLAW.md', 'HUMAN.md', 'CLAWAS.md', 'CURIOUS.md', 'TOOLS.md']) {
      await writeFile(join(dir, name), `# ${name}\n\nloaded ${name}\n`, 'utf8')
    }
    await writeFile(
      join(dir, 'HEARTBEAT.md'),
      '# HEARTBEAT.md\n\nstale pulse should not load\n',
      'utf8',
    )

    const files = await loadHydrationFiles(dir)
    assert.deepEqual(
      files.map((file) => file.name),
      ['CLAW.md', 'HUMAN.md', 'CLAWAS.md', 'CURIOUS.md', 'TOOLS.md'],
    )

    const prompt = buildHydrationSystemPrompt(files)
    assert.match(prompt, /--- BEGIN CLAW\.md ---/)
    assert.match(prompt, /--- BEGIN HUMAN\.md ---/)
    assert.match(prompt, /--- BEGIN CLAWAS\.md ---/)
    assert.match(prompt, /--- BEGIN CURIOUS\.md ---/)
    assert.match(prompt, /--- BEGIN TOOLS\.md ---/)
    assert.doesNotMatch(prompt, /HEARTBEAT\.md/)
    assert.doesNotMatch(prompt, /stale pulse should not load/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('TOOLS.md is not truncated at normal template size', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clawa-tools-hydrate-'))
  try {
    await writeFile(
      join(dir, 'TOOLS.md'),
      ['# TOOLS.md', '', '<mcp_tools>', '- example_tool', '</mcp_tools>'].join('\n'),
      'utf8',
    )

    const files = await loadHydrationFiles(dir)
    const tools = files.find((file) => file.name === 'TOOLS.md')
    assert.ok(tools, 'TOOLS.md should load')
    assert.equal(tools.truncated, false)
    assert.match(tools.content, /<mcp_tools>/)
    assert.match(tools.content, /<\/mcp_tools>/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
