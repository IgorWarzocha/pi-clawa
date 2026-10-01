import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { DEFAULT_CLAWA_DEFAULTS } from '../config.js'
import { configuredProviderEnvironmentKeys, panelEnvironment } from './panel-command.js'

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
