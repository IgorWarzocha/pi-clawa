import assert from 'node:assert/strict'
import test from 'node:test'
import { CLAWA_PERSONAL_ASSISTANT_INTRO, replacePiDefaultAssistantIntro } from './system-prompt.js'

const piDefault = [
  'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.',
  '',
  'Available tools:',
  '- read: read files',
].join('\n')

test('replacePiDefaultAssistantIntro preserves Pi tool section', () => {
  const replaced = replacePiDefaultAssistantIntro(piDefault)

  assert.ok(replaced.startsWith(CLAWA_PERSONAL_ASSISTANT_INTRO))
  assert.ok(replaced.includes('\nAvailable tools:\n- read: read files'))
  assert.equal(replaced.includes('expert coding assistant operating inside pi'), false)
})

test('replacePiDefaultAssistantIntro leaves custom system prompts alone', () => {
  const custom = '# Custom prompt\n\nAvailable tools:\n- read'
  assert.equal(replacePiDefaultAssistantIntro(custom), custom)
})
