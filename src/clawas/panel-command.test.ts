import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { DEFAULT_CLAWA_DEFAULTS } from '../config.js'
import {
  configuredProviderEnvironmentKeys,
  panelArgs,
  panelEnvironment,
  shellQuote,
} from './panel-command.js'

test('native Pi launch keeps session identity and worker reporting without RPC or takeover flags', () => {
  const options = {
    definition: {
      id: 'writer',
      title: 'Writer',
      cwd: '/tmp',
      enabled: true,
      autostart: true,
      fastMode: false,
      reportMode: 'explicit' as const,
    },
    cwd: '/tmp',
    extensionPaths: ['/tmp/ext with space.ts'],
    clawaDefaults: DEFAULT_CLAWA_DEFAULTS,
    projectRoot: '/home/project root',
    sessionFile: '/tmp/worker session.jsonl',
  }
  assert.deepEqual(panelArgs(options), [
    '--session',
    options.sessionFile,
    '--session-dir',
    '/tmp/.pi/sessions',
    '--name',
    'Clawas / Writer',
    '--extension',
    '/tmp/ext with space.ts',
  ])
  const env = panelEnvironment(options, {})
  assert.equal(env['PI_CLAW_PROJECT_ROOT'], options.projectRoot)
  assert.equal(env['PI_CLAWAS_REPORT_SESSION_ID'], 'main-claw')
  assert.equal(env['PI_CLAWAS_DISCORD_ENABLED'], undefined)
  assert.equal(env['PI_CLAWAS_REPORT_MODE'], 'explicit')
  assert.equal(env['PI_CODEX_FAST'], '0')
  assert.equal(env['PI_CLAWAS_MANUAL_SESSION'], undefined)
  assert.equal(shellQuote("can't $(touch /tmp/nope)"), "'can'\\''t $(touch /tmp/nope)'")
})

test('custom provider references survive native launch without copying host identity or escaped literals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-provider-env-'))
  const previous = process.env['PI_CODING_AGENT_DIR']
  process.env['PI_CODING_AGENT_DIR'] = root
  try {
    const modelsPath = join(root, 'models.json')
    const tenantVariable = 'CUSTOM_VENDOR_TENANT'
    await writeFile(
      modelsPath,
      JSON.stringify({
        providers: {
          custom: {
            api: 'openai-completions',
            baseUrl: 'http://127.0.0.1:1',
            apiKey: '$CUSTOM_VENDOR_AUTH',
            headers: {
              'X-Tenant': `\${${tenantVariable}}`,
              'X-Literal': '$$NOT_A_REFERENCE',
              'X-Host': '$HERDR_PANE_ID',
            },
            models: [{ id: 'local', name: 'Local' }],
          },
        },
      }),
    )
    const runtime = await ModelRuntime.create({
      authPath: join(root, 'auth.json'),
      modelsPath,
      modelsStorePath: join(root, 'models-store.json'),
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    runtime.registerProvider('openai', { apiKey: '$CUSTOM_EXTENSION_AUTH' })
    const keys = await configuredProviderEnvironmentKeys(new ModelRegistry(runtime))
    const source = {
      CUSTOM_VENDOR_AUTH: 'synthetic-vendor-auth',
      [tenantVariable]: 'synthetic-tenant',
      CUSTOM_EXTENSION_AUTH: 'synthetic-extension-auth',
      HERDR_PANE_ID: 'main-pane',
      NOT_A_REFERENCE: 'must-not-forward',
    }
    const env = panelEnvironment(
      {
        definition: { id: 'helper', title: 'Helper', cwd: root, enabled: true, autostart: true },
        cwd: root,
        extensionPaths: [],
        clawaDefaults: DEFAULT_CLAWA_DEFAULTS,
        projectRoot: root,
        sessionFile: join(root, 'session.jsonl'),
      },
      source,
      keys,
    )
    assert.equal(env['CUSTOM_VENDOR_AUTH'], source.CUSTOM_VENDOR_AUTH)
    assert.equal(env[tenantVariable], source[tenantVariable])
    assert.equal(env['CUSTOM_EXTENSION_AUTH'], source.CUSTOM_EXTENSION_AUTH)
    assert.equal(env['HERDR_PANE_ID'], undefined)
    assert.equal(env['NOT_A_REFERENCE'], undefined)
    const auth = await runtime.getAuth('custom', { env: { ...env, HERDR_PANE_ID: 'child-pane' } })
    assert.equal(auth?.auth.apiKey, source.CUSTOM_VENDOR_AUTH)
    // Read failures cannot silently omit configured references or echo literal credentials.
    await writeFile(modelsPath, '{ "apiKey": "literal-not-for-diagnostics",')
    await assert.rejects(configuredProviderEnvironmentKeys(), {
      message: 'Invalid Pi models.json; fix its syntax before launching a worker',
    })
    await rm(modelsPath)
    await mkdir(modelsPath)
    await assert.rejects(configuredProviderEnvironmentKeys(), {
      message: 'Cannot read Pi models.json for worker environment forwarding',
    })
  } finally {
    if (previous === undefined) delete process.env['PI_CODING_AGENT_DIR']
    else process.env['PI_CODING_AGENT_DIR'] = previous
    await rm(root, { recursive: true, force: true })
  }
})

test('worker launch forwards provider and launch settings without main terminal or session identity', () => {
  const options = {
    definition: {
      id: 'writer',
      title: 'Writer',
      cwd: '/tmp',
      enabled: true,
      autostart: true,
      fastMode: false,
    },
    cwd: '/tmp',
    extensionPaths: [],
    clawaDefaults: DEFAULT_CLAWA_DEFAULTS,
    projectRoot: '/home/project',
    sessionFile: '/tmp/session.jsonl',
  }
  const forwarded = {
    OPENAI_API_KEY: 'synthetic-openai-key',
    ANTHROPIC_AUTH_TOKEN: 'synthetic-auth-token',
    GEMINI_API_KEY: 'synthetic-gemini-key',
    GOOGLE_APPLICATION_CREDENTIALS: '/tmp/credentials.json',
    GOOGLE_CLOUD_PROJECT: 'project',
    GOOGLE_CLOUD_LOCATION: 'location',
    AZURE_OPENAI_BASE_URL: 'https://example.invalid',
    AWS_PROFILE: 'profile',
    AWS_SESSION_TOKEN: 'synthetic-session-token',
    AWS_REGION: 'region',
    COPILOT_GITHUB_TOKEN: 'synthetic-copilot-token',
    CLOUDFLARE_ACCOUNT_ID: 'account',
    HTTPS_PROXY: 'https://example.invalid:8443',
    NO_PROXY: '',
    NODE_EXTRA_CA_CERTS: '/tmp/ca.pem',
    HOME: '/home/worker',
    PATH: '/tmp/bin',
    PI_CODING_AGENT_DIR: '/tmp/agent',
    XDG_RUNTIME_DIR: '/tmp/runtime',
    PI_CLAWAS_CONTROL_SOCKET_ROOT: '/tmp/control',
  }
  const excluded = {
    TMUX: '/tmp/main-tmux,10,0',
    TMUX_PANE: '%1',
    HERDR_ENV: '1',
    HERDR_PANE_ID: 'main-pane',
    HERDR_SOCKET_PATH: '/tmp/main-herdr',
    TERM: 'main-terminal',
    TERM_PROGRAM: 'main-host',
    WINDOWID: 'main-window',
    PWD: '/main',
    PI_CLAWAS_MANUAL_SESSION: 'main-session',
    PI_CLAWAS_DISCORD_ENABLED: '1',
    UNRELATED_API_KEY: 'synthetic-unrelated-key',
  }
  const env = panelEnvironment(options, {
    ...forwarded,
    ...excluded,
    PI_CODEX_FAST: '1',
    PI_CLAWAS_ROLE: 'main',
    PI_CLAWAS_WORKER_ID: 'main-claw',
    PI_CLAW_PROJECT_ROOT: '/wrong-project',
  })
  for (const [key, value] of Object.entries(forwarded)) assert.equal(env[key], value, key)
  for (const key of Object.keys(excluded)) assert.equal(env[key], undefined, key)
  assert.equal(env['PI_CLAWAS_ROLE'], 'worker')
  assert.equal(env['PI_CLAWAS_WORKER_ID'], options.definition.id)
  assert.equal(env['PI_CLAW_PROJECT_ROOT'], options.projectRoot)
  assert.equal(env['PI_CODEX_FAST'], '0')
  assert.equal(
    panelEnvironment(
      { ...options, definition: { ...options.definition, fastMode: undefined } },
      {
        PI_CODEX_FAST: '1',
      },
    )['PI_CODEX_FAST'],
    '1',
  )
})
