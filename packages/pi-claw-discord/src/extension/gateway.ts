import { spawn } from 'node:child_process'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { resolveClawaDefaults, resolveClawasControlSocketRoot } from '@howaboua/pi-claw/config'
import { DISCORD_CONFIG_RELATIVE, GATEWAY_ENTRY } from './constants.js'
import { ensureDiscordConfig, readEnvFile } from './env-file.js'
import { getGatewayProcess, setGatewayConfigPath, setGatewayProcess } from './gateway-state.js'

function hasGatewayToken(configPath: string): boolean {
  return Boolean(readEnvFile(configPath).DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN)
}

export function startGateway(projectRoot: string, ctx: ExtensionContext): void {
  const configPath = ensureDiscordConfig(projectRoot)
  setGatewayConfigPath(configPath)

  if (!hasGatewayToken(configPath)) {
    if (ctx.hasUI)
      ctx.ui.notify(
        `Discord gateway config created at ${configPath}; add DISCORD_BOT_TOKEN to start it.`,
        'warning',
      )
    return
  }

  const existing = getGatewayProcess()
  if (existing && !existing.killed) return

  const clawa = resolveClawaDefaults(projectRoot)
  const gatewayProcess = spawn(process.execPath, ['--import', 'tsx', GATEWAY_ENTRY, 'start'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PIDG_CONFIG: DISCORD_CONFIG_RELATIVE,
      PI_CWD: '.',
      PI_CLAW_PROJECT_ROOT: projectRoot,
      PI_CLAWAS_CONTROL_SOCKET_ROOT: resolveClawasControlSocketRoot(projectRoot),
      PI_CLAWAS_CONTROL_SOCKET_DIR: clawa.controlSocketDir,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  setGatewayProcess(gatewayProcess)

  gatewayProcess.stderr?.on('data', (chunk) => {
    const text = String(chunk).trim()
    if (text && ctx.hasUI) ctx.ui.notify(`Discord gateway: ${text.slice(0, 240)}`, 'warning')
  })

  gatewayProcess.once('exit', (code, signal) => {
    setGatewayProcess(null)
    if (ctx.hasUI && code !== 0 && signal !== 'SIGTERM') {
      ctx.ui.notify(`Discord gateway stopped (${signal ?? code ?? 'unknown'})`, 'warning')
    }
  })

  if (ctx.hasUI) ctx.ui.notify('Discord gateway started for this Clawa workspace.', 'info')
}

export function stopGateway(): void {
  getGatewayProcess()?.kill('SIGTERM')
  setGatewayProcess(null)
}

export function restartGateway(projectRoot: string, ctx: ExtensionContext): void {
  stopGateway()
  startGateway(projectRoot, ctx)
}
