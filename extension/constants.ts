import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const extensionPath = fileURLToPath(new URL('../index.ts', import.meta.url))
const extensionDir = dirname(extensionPath)
const templatesDir = join(extensionDir, 'templates')
export const mainTemplatesDir = join(templatesDir, 'main')
export const workerTemplatesDir = join(templatesDir, 'worker')
export const HYDRATION_MESSAGE_TYPE = 'claw-hydration'
export const IS_CLAWAS_WORKER = process.env.PI_CLAWAS_ROLE === 'worker'

const privacyCalibrationText = readFileSync(
  join(templatesDir, 'bootstrap', 'PRIVACY.md'),
  'utf8',
).trim()

export const INITIAL_BOOTSTRAP_PROMPT = [
  'This is your first Clawa bootstrap turn in this home.',
  'The extension has created your starter living docs in the project root. Shape them with me now, then keep refining them over time.',
  '',
  'Start small. Do not turn this into a giant intake form.',
  'First establish only the basics:',
  '- your name, signature, voice, and working style',
  '- my basics and preferences that matter immediately',
  '- the privacy/security baseline below',
  '',
  'Write the useful answers into the living docs as they become clear:',
  '- CLAW.md for name, voice, temperament, and taste',
  '- HUMAN.md for my preferences and context',
  '- CLAWAS.md for specialized Clawas once they exist',
  '- CURIOUS.md for sparks and open threads',
  '- TOOLS.md for local tooling notes',
  '- AGENTS.md only for behavior that should shape every future reply',
  '',
  'There are no default subclawas. If a real specialized lane appears later, propose one and create it from a purpose.',
  'Use recall before pretending the house has no past; use remember for small raw notes worth carrying, then promote shaped truth into the docs.',
  '',
  'Final bootstrap step: run the privacy/security calibration below.',
  'Ask naturally in chat, up to three questions at a time, include "Needs follow-up", and keep going until the baseline is clear.',
  'Fold the answers into AGENTS.md, HUMAN.md, CLAW.md, or TOOLS.md as appropriate. Leave the worksheet itself behind.',
  '',
  privacyCalibrationText,
].join('\n')
