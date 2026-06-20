import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildHydrationSystemPrompt, loadHydrationFiles } from '../src/hydrate.js'

const BEGIN_CLAW_REGEX = /--- BEGIN CLAW\.md ---/
const BEGIN_HUMAN_REGEX = /--- BEGIN HUMAN\.md ---/
const BEGIN_CLAWAS_REGEX = /--- BEGIN CLAWAS\.md ---/
const BEGIN_CURIOUS_REGEX = /--- BEGIN CURIOUS\.md ---/
const BEGIN_TOOLS_REGEX = /--- BEGIN TOOLS\.md ---/
const MCP_TOOLS_OPEN_REGEX = /<mcp_tools>/
const MCP_TOOLS_CLOSE_REGEX = /<\/mcp_tools>/

test('hydration loads active continuity files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'howaboua-hydrate-'))
  try {
    for (const name of ['CLAW.md', 'HUMAN.md', 'CLAWAS.md', 'CURIOUS.md', 'TOOLS.md']) {
      await writeFile(join(dir, name), `# ${name}\n\nloaded ${name}\n`, 'utf8')
    }
    const files = await loadHydrationFiles(dir)
    assert.deepEqual(
      files.map((file) => file.name),
      ['CLAW.md', 'HUMAN.md', 'CLAWAS.md', 'CURIOUS.md', 'TOOLS.md'],
    )

    const prompt = buildHydrationSystemPrompt(files)
    assert.match(prompt, BEGIN_CLAW_REGEX)
    assert.match(prompt, BEGIN_HUMAN_REGEX)
    assert.match(prompt, BEGIN_CLAWAS_REGEX)
    assert.match(prompt, BEGIN_CURIOUS_REGEX)
    assert.match(prompt, BEGIN_TOOLS_REGEX)
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
    assert.match(tools.content, MCP_TOOLS_OPEN_REGEX)
    assert.match(tools.content, MCP_TOOLS_CLOSE_REGEX)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
