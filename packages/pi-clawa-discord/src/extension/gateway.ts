import { type ChildProcess, spawn } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { resolveClawaDefaults, resolveClawasControlSocketRoot } from '@howaboua/pi-clawa/config'
import {
  type GatewayLockRecord,
  isGatewayProcessAlive,
  readGatewayLock,
} from '../shared/gateway-lock.js'
import { extensionDir, GATEWAY_ENTRY } from './constants.js'
import { ensureDiscordConfig, readEnvFile } from './env-file.js'
import { getGatewayState, setGatewayState } from './gateway-state.js'

const GRACEFUL_STOP_TIMEOUT_MS = 20_000
const FORCE_STOP_TIMEOUT_MS = 2_000
const LOG_MAX_BYTES = 5 * 1024 * 1024
const LOG_RETAIN_BYTES = 2 * 1024 * 1024

function hasGatewayToken(configPath: string): boolean {
  return Boolean(readEnvFile(configPath)['DISCORD_BOT_TOKEN'] || process.env['DISCORD_BOT_TOKEN'])
}

export async function startGateway(projectRoot: string, ctx: ExtensionContext): Promise<void> {
  const configPath = ensureDiscordConfig(projectRoot)
  if (!hasGatewayToken(configPath)) {
    if (ctx.hasUI) {
      ctx.ui.notify(
        `Discord gateway config created at ${configPath}; add DISCORD_BOT_TOKEN to start it.`,
        'warning',
      )
    }
    return
  }

  const current = getGatewayState()
  if (isLiveState(current)) return

  const lockPath = resolveGatewayLockPath(projectRoot, configPath)
  const lock = await readGatewayLock(lockPath)
  if (lock && isGatewayProcessAlive(lock)) {
    setGatewayState({ status: 'running-adopted', projectRoot, lockPath, lock })
    if (ctx.hasUI) ctx.ui.notify('Adopted the running Discord gateway for this workspace.', 'info')
    return
  }

  setGatewayState({ status: 'starting', projectRoot })
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
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  setGatewayState({
    status: 'running-owned',
    projectRoot,
    lockPath,
    process: gatewayProcess,
  })

  const logPath = join(projectRoot, '.pi', 'clawa-discord', 'gateway.log')
  prepareGatewayLog(logPath)
  gatewayProcess.stdout?.on('data', (chunk) => appendGatewayLog(logPath, chunk))
  gatewayProcess.stderr?.on('data', (chunk) => {
    appendGatewayLog(logPath, chunk)
    const text = String(chunk).trim()
    if (text && ctx.hasUI) ctx.ui.notify(`Discord gateway: ${text.slice(0, 240)}`, 'warning')
  })

  gatewayProcess.once('error', (error) => {
    const state = getGatewayState()
    if (state.status === 'running-owned' && state.process === gatewayProcess) {
      setGatewayState({ status: 'failed', projectRoot, error: error.message })
    }
  })
  gatewayProcess.once('exit', (code, signal) => {
    const state = getGatewayState()
    if (state.status === 'running-owned' && state.process === gatewayProcess) {
      setGatewayState({ status: 'stopped' })
    }
    if (ctx.hasUI && code !== 0 && signal !== 'SIGTERM') {
      ctx.ui.notify(`Discord gateway stopped (${signal ?? code ?? 'unknown'})`, 'warning')
    }
  })

  if (ctx.hasUI) ctx.ui.notify('Discord gateway started for this Clawa workspace.', 'info')
}

export async function stopGateway(options: { stopAdopted?: boolean } = {}): Promise<void> {
  const state = getGatewayState()
  if (state.status === 'running-owned') {
    await stopOwnedGateway(state.process, state.projectRoot)
    return
  }
  if (state.status === 'running-adopted') {
    if (options.stopAdopted === false) {
      setGatewayState({ status: 'stopped' })
      return
    }
    await stopAdoptedGateway(state.lock, state.projectRoot)
    return
  }
  if (state.status !== 'stopped') setGatewayState({ status: 'stopped' })
}

export async function restartGateway(projectRoot: string, ctx: ExtensionContext): Promise<void> {
  await stopGateway()
  await startGateway(projectRoot, ctx)
}

function resolveGatewayLockPath(projectRoot: string, configPath: string): string {
  const configuredDbPath = readEnvFile(configPath)['DB_PATH']?.trim()
  const dbPath = configuredDbPath
    ? isAbsolute(configuredDbPath)
      ? configuredDbPath
      : resolve(projectRoot, configuredDbPath)
    : join(projectRoot, '.pi', 'clawa-discord', 'gateway.db')
  return join(dirname(dbPath), 'gateway.pid')
}

function isLiveState(state: ReturnType<typeof getGatewayState>): boolean {
  if (state.status === 'running-owned') return isChildProcessRunning(state.process)
  if (state.status === 'running-adopted') return isGatewayProcessAlive(state.lock)
  return state.status === 'starting' || state.status === 'stopping'
}

async function stopOwnedGateway(gatewayProcess: ChildProcess, projectRoot: string): Promise<void> {
  if (!isChildProcessRunning(gatewayProcess)) {
    setGatewayState({ status: 'stopped' })
    return
  }
  setGatewayState({ status: 'stopping', projectRoot, pid: gatewayProcess.pid ?? 0 })
  const exit = observeProcessExit(gatewayProcess)
  gatewayProcess.kill('SIGTERM')
  const stopped = await waitForExit(exit.promise, GRACEFUL_STOP_TIMEOUT_MS)
  if (!stopped && isChildProcessRunning(gatewayProcess)) {
    gatewayProcess.kill('SIGKILL')
    const forceStopped = await waitForExit(exit.promise, FORCE_STOP_TIMEOUT_MS)
    if (!forceStopped && isChildProcessRunning(gatewayProcess)) {
      exit.dispose()
      throw new Error(`Discord gateway process ${gatewayProcess.pid ?? 'unknown'} did not stop`)
    }
  }
  exit.dispose()
  setGatewayState({ status: 'stopped' })
}

async function stopAdoptedGateway(lock: GatewayLockRecord, projectRoot: string): Promise<void> {
  setGatewayState({ status: 'stopping', projectRoot, pid: lock.pid })
  try {
    process.kill(lock.pid, 'SIGTERM')
  } catch (error) {
    if (!isMissingProcessError(error)) throw error
    setGatewayState({ status: 'stopped' })
    return
  }
  if (!(await waitForProcessStop(lock, GRACEFUL_STOP_TIMEOUT_MS))) {
    process.kill(lock.pid, 'SIGKILL')
    if (!(await waitForProcessStop(lock, FORCE_STOP_TIMEOUT_MS))) {
      throw new Error(`Discord gateway process ${lock.pid} did not stop`)
    }
  }
  setGatewayState({ status: 'stopped' })
}

function isMissingProcessError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'
}

function isChildProcessRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

function observeProcessExit(child: ChildProcess): {
  promise: Promise<void>
  dispose: () => void
} {
  let resolveExit!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolveExit = resolvePromise
  })
  const finish = () => {
    child.off('exit', finish)
    child.off('error', finish)
    resolveExit()
  }
  child.once('exit', finish)
  child.once('error', finish)
  return {
    promise,
    dispose: () => {
      child.off('exit', finish)
      child.off('error', finish)
    },
  }
}

async function waitForExit(exit: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      exit.then(() => true),
      new Promise<false>((resolvePromise) => {
        timer = setTimeout(() => resolvePromise(false), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function waitForProcessStop(lock: GatewayLockRecord, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isGatewayProcessAlive(lock)) return true
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  return !isGatewayProcessAlive(lock)
}

function prepareGatewayLog(logPath: string): void {
  mkdirSync(dirname(logPath), { recursive: true })
  if (!existsSync(logPath) || statSync(logPath).size <= LOG_MAX_BYTES) return
  const contents = readFileSync(logPath)
  writeFileSync(logPath, contents.subarray(Math.max(0, contents.length - LOG_RETAIN_BYTES)))
}

function appendGatewayLog(logPath: string, chunk: string | Buffer): void {
  appendFileSync(logPath, chunk)
  if (statSync(logPath).size <= LOG_MAX_BYTES) return
  const contents = readFileSync(logPath)
  writeFileSync(logPath, contents.subarray(Math.max(0, contents.length - LOG_RETAIN_BYTES)))
}
