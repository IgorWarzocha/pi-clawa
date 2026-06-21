import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { resolveClawaDefaults, resolveClawasControlSocketRoot } from '@howaboua/pi-clawa/config'
import { extensionDir, GATEWAY_ENTRY } from './constants.js'
import { ensureDiscordConfig, readEnvFile } from './env-file.js'
import { getGatewayProcess, setGatewayProcess } from './gateway-state.js'

function hasGatewayToken(configPath: string): boolean {
  return Boolean(readEnvFile(configPath)['DISCORD_BOT_TOKEN'] || process.env['DISCORD_BOT_TOKEN'])
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function hasLiveGatewayPid(configPath: string): boolean {
  const dbPath = readEnvFile(configPath)['DB_PATH']
  const stateDir = dbPath ? dirname(dbPath) : join(dirname(configPath))
  try {
    const pid = Number.parseInt(readFileSync(join(stateDir, 'gateway.pid'), 'utf8').trim(), 10)
    return Number.isFinite(pid) && pid > 0 && isProcessAlive(pid)
  } catch {
    return false
  }
}

export function startGateway(projectRoot: string, ctx: ExtensionContext): void {
  const configPath = ensureDiscordConfig(projectRoot)

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
  if (hasLiveGatewayPid(configPath)) return

  const clawa = resolveClawaDefaults(projectRoot)
  const gatewayProcess = spawn(process.execPath, ['--import', 'tsx', GATEWAY_ENTRY, 'start'], {
    cwd: extensionDir,
    env: {
      ...process.env,
      PI_CLAWA_DISCORD_CONFIG: configPath,
      PI_CWD: projectRoot,
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
