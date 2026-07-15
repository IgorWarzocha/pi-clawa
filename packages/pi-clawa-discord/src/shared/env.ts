import { readFileSync } from 'node:fs'
import { parse } from 'dotenv'

const INTEGER_PATTERN = /^-?\d+$/u

export function readEnvFile(filePath: string): Record<string, string> {
  try {
    return parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    if (isMissingFileError(error)) return {}
    throw error
  }
}

export function parseIntegerSetting(
  source: Record<string, string>,
  key: string,
  fallback: number,
  options: { min?: number } = {},
): number {
  const raw = setting(source, key)
  if (!raw) return fallback
  if (!INTEGER_PATTERN.test(raw)) throw invalidSetting(key, raw, 'an integer')
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) throw invalidSetting(key, raw, 'a safe integer')
  if (options.min !== undefined && value < options.min) {
    throw invalidSetting(key, raw, `at least ${options.min}`)
  }
  return value
}

export function parseBooleanSetting(
  source: Record<string, string>,
  key: string,
  fallback: boolean,
): boolean {
  const raw = setting(source, key).toLowerCase()
  if (!raw) return fallback
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  throw invalidSetting(key, raw, 'true/false, yes/no, on/off, or 1/0')
}

export function parseEnumSetting<const T extends string>(
  source: Record<string, string>,
  key: string,
  fallback: T,
  values: readonly T[],
): T {
  const raw = setting(source, key)
  if (!raw) return fallback
  if (values.some((value) => value === raw)) return raw as T
  throw invalidSetting(key, raw, values.join(', '))
}

function setting(source: Record<string, string>, key: string): string {
  return (source[key] ?? '').trim()
}

function invalidSetting(key: string, value: string, expected: string): Error {
  return new Error(`Invalid ${key}=${JSON.stringify(value)}; expected ${expected}.`)
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
