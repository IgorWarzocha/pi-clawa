import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  DEFAULT_CLAWA_COMPACTION_CONFIG,
  DEFAULT_CLAWA_DEFAULTS,
  DEFAULT_SUMMARY_MAX_TOKENS,
  ensureClawEnvironmentConfig,
  loadClawEnvironmentConfig,
  normalizeCompactionSummaryMaxTokens,
  normalizeCompactionTriggerTokens,
  upsertClawaWorkerConfig,
} from '../src/config.js'

test('default compaction config has no trigger and 20K summary cap', () => {
  assert.deepEqual(DEFAULT_CLAWA_COMPACTION_CONFIG, { summaryMaxTokens: 20_000 })
  assert.equal(DEFAULT_CLAWA_DEFAULTS.compaction.triggerTokens, undefined)
  assert.equal(DEFAULT_CLAWA_DEFAULTS.compaction.summaryMaxTokens, 20_000)
})

test('normalizeCompactionTriggerTokens accepts positive safe integers', () => {
  assert.equal(normalizeCompactionTriggerTokens(130_000), 130_000)
  assert.equal(normalizeCompactionTriggerTokens(20_000), 20_000)
})

test('normalizeCompactionTriggerTokens rejects invalid values', () => {
  assert.equal(normalizeCompactionTriggerTokens(undefined), undefined)
  assert.equal(normalizeCompactionTriggerTokens(null), undefined)
  assert.equal(normalizeCompactionTriggerTokens(0), undefined)
  assert.equal(normalizeCompactionTriggerTokens(-1), undefined)
  assert.equal(normalizeCompactionTriggerTokens(1.5), undefined)
  assert.equal(normalizeCompactionTriggerTokens(Number.NaN), undefined)
  assert.equal(normalizeCompactionTriggerTokens(Number.POSITIVE_INFINITY), undefined)
  assert.equal(normalizeCompactionTriggerTokens(Number.NEGATIVE_INFINITY), undefined)
  assert.equal(normalizeCompactionTriggerTokens(Number.MAX_SAFE_INTEGER + 1), undefined)
  assert.equal(normalizeCompactionTriggerTokens('130000'), undefined)
})

test('normalizeCompactionSummaryMaxTokens falls back to 20K for invalid values', () => {
  assert.equal(normalizeCompactionSummaryMaxTokens(undefined), DEFAULT_SUMMARY_MAX_TOKENS)
  assert.equal(normalizeCompactionSummaryMaxTokens(0), DEFAULT_SUMMARY_MAX_TOKENS)
  assert.equal(normalizeCompactionSummaryMaxTokens(1.5), DEFAULT_SUMMARY_MAX_TOKENS)
  assert.equal(normalizeCompactionSummaryMaxTokens(Number.NaN), DEFAULT_SUMMARY_MAX_TOKENS)
  assert.equal(
    normalizeCompactionSummaryMaxTokens(Number.POSITIVE_INFINITY),
    DEFAULT_SUMMARY_MAX_TOKENS,
  )
})

test('loadClawEnvironmentConfig parses valid compaction settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-compaction-config-'))
  try {
    await mkdir(join(root, '.pi'), { recursive: true })
    await writeFile(
      join(root, '.pi', 'claw.jsonc'),
      JSON.stringify({
        bootstrapped: true,
        clawas: { baseDir: 'clawas', tmuxSession: 'clawas', workers: [] },
        clawa: {
          compaction: { triggerTokens: 130_000, summaryMaxTokens: 20_000 },
        },
      }),
      'utf8',
    )

    const loaded = loadClawEnvironmentConfig(root)
    assert.deepEqual(loaded.config.clawa.compaction, {
      triggerTokens: 130_000,
      summaryMaxTokens: 20_000,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('loadClawEnvironmentConfig ignores invalid triggerTokens', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-compaction-config-invalid-'))
  try {
    await mkdir(join(root, '.pi'), { recursive: true })
    await writeFile(
      join(root, '.pi', 'claw.jsonc'),
      JSON.stringify({
        bootstrapped: true,
        clawas: { baseDir: 'clawas', tmuxSession: 'clawas', workers: [] },
        clawa: {
          compaction: { triggerTokens: 130_000.5, summaryMaxTokens: 0 },
        },
      }),
      'utf8',
    )

    const loaded = loadClawEnvironmentConfig(root)
    assert.deepEqual(loaded.config.clawa.compaction, {
      summaryMaxTokens: 20_000,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('upsertClawaWorkerConfig preserves nested clawa.compaction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-compaction-upsert-'))
  try {
    await mkdir(join(root, '.git'))
    ensureClawEnvironmentConfig(root)
    await writeFile(
      join(root, '.pi', 'claw.jsonc'),
      JSON.stringify({
        bootstrapped: true,
        clawas: { baseDir: 'clawas', tmuxSession: 'clawas', workers: [] },
        clawa: {
          compaction: { triggerTokens: 130_000, summaryMaxTokens: 20_000 },
        },
      }),
      'utf8',
    )

    upsertClawaWorkerConfig(root, {
      id: 'docs-clawa',
      title: 'Docs Clawa',
      cwd: 'clawas/docs-clawa',
    })

    const config = JSON.parse(await readFile(join(root, '.pi', 'claw.jsonc'), 'utf8'))
    assert.deepEqual(config.clawa.compaction, {
      triggerTokens: 130_000,
      summaryMaxTokens: 20_000,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('generated default config does not include an enabled trigger', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-compaction-default-'))
  try {
    const generated = ensureClawEnvironmentConfig(root).config
    assert.equal(generated.clawa.compaction.triggerTokens, undefined)
    assert.equal(generated.clawa.compaction.summaryMaxTokens, 20_000)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
