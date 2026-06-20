import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const extensionPath = fileURLToPath(new URL('../index.ts', import.meta.url))
const extensionDir = dirname(extensionPath)
const packageRoot = dirname(extensionDir)
export const templatesDir = join(packageRoot, 'templates')
export const mainTemplatesDir = join(templatesDir, 'main')
export const workerTemplatesDir = join(templatesDir, 'worker')
export const HYDRATION_MESSAGE_TYPE = 'claw-hydration'
export const IS_CLAWAS_WORKER = process.env['PI_CLAWAS_ROLE'] === 'worker'
