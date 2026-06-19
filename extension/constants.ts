import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const extensionPath = fileURLToPath(new URL('../index.ts', import.meta.url))
const extensionDir = dirname(extensionPath)
const templatesDir = join(extensionDir, 'templates')
export const mainTemplatesDir = join(templatesDir, 'main')
export const HYDRATION_MESSAGE_TYPE = 'claw-hydration'
export const IS_CLAWAS_WORKER = process.env.PI_CLAWAS_ROLE === 'worker'

const privacyCalibrationText = readFileSync(
  join(templatesDir, 'bootstrap', 'PRIVACY.md'),
  'utf8',
).trim()

export const INITIAL_BOOTSTRAP_PROMPT = [
  'This is the first Clawa bootstrap turn for this workspace.',
  'The extension has just created the main continuity files in the project root.',
  '',
  'Start by establishing your shape with the human:',
  '- your name',
  '- your nature and working style',
  '- your vibe and emoji',
  '- core user basics and preferences',
  '- boundaries for local work and external actions',
  '',
  'Persist the useful parts immediately into the appropriate files:',
  '- CLAW.md for name, voice, temperament, and taste',
  '- HUMAN.md for human preferences and context',
  '- CLAWAS.md for sibling Clawas, lanes, and routing notes',
  '- CURIOUS.md for sparks and open threads',
  '- TOOLS.md for local tooling notes',
  '',
  'Final bootstrap step: run the privacy/security calibration below with the human.',
  'Ask naturally in chat, up to three questions at a time, include "Needs follow-up", and keep going until the baseline is clear.',
  'Fold the answers into AGENTS.md, HUMAN.md, CLAW.md, or TOOLS.md as appropriate.',
  '',
  privacyCalibrationText,
].join('\n')
