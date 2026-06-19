import { type ChildProcess, spawn } from 'node:child_process'
import type { AgentEvent } from '@earendil-works/pi-agent-core'
import { HowabandaRpcChannel } from './rpc-channel.js'
import type { HowabandaRpcCommand, HowabandaRpcSessionState } from './rpc-types.js'
import type { WorkerDefinition } from './types.js'
import { getWorkerSocketAlias } from './worker-identity.js'

interface WorkerProcessOptions {
  definition: WorkerDefinition
  cwd: string
  extensionPaths: string[]
  reportSessionId?: string
  sessionFile?: string
}

function buildWorkerProcessArgs(options: WorkerProcessOptions): string[] {
  const args = ['--mode', 'rpc']

  if (options.sessionFile) {
    args.push('--session', options.sessionFile)
  } else {
    args.push('-c')
  }

  for (const extensionPath of options.extensionPaths) {
    args.push('--extension', extensionPath)
  }
  if (options.definition.model) {
    args.push('--model', options.definition.model)
  }
  if (options.definition.thinking) {
    args.push('--thinking', options.definition.thinking)
  }

  return args
}

function buildWorkerEnvironment(options: WorkerProcessOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PI_SKIP_VERSION_CHECK: '1',
    PI_HOWABANDA_ROLE: 'worker',
    PI_CLAW_PROJECT_ROOT: process.env.PI_CLAW_PROJECT_ROOT,
    PI_CWD: process.env.PI_CLAW_PROJECT_ROOT,
    PI_HOWABANDA_CONTROL_SOCKET_ROOT: process.env.PI_HOWABANDA_CONTROL_SOCKET_ROOT,
    PI_HOWABANDA_WORKER_ID: options.definition.id,
    PI_HOWABANDA_WORKER_TITLE: options.definition.title,
    PI_HOWABANDA_SOCKET_ALIAS: getWorkerSocketAlias(options.definition),
  }
  if (options.reportSessionId) {
    env.PI_HOWABANDA_REPORT_SESSION_ID = options.reportSessionId
  }
  if (options.definition.discordEnabled) {
    env.PI_HOWABANDA_DISCORD_ENABLED = '1'
  }
  if (options.definition.reportMode) {
    env.PI_HOWABANDA_REPORT_MODE = options.definition.reportMode
  }
  return env
}

/**
 * Small RPC wrapper around a single `pi -c --mode rpc` worker process.
 * The daemon should not need to care about JSONL framing or request bookkeeping.
 */
export class HowabandaRpcWorker {
  readonly definition: WorkerDefinition
  readonly cwd: string
  readonly extensionPaths: string[]

  private process: ChildProcess | null = null
  private readonly eventListeners = new Set<(event: AgentEvent) => void>()
  private readonly closeListeners = new Set<
    (code: number | null, signal: NodeJS.Signals | null) => void
  >()
  private readonly channel: HowabandaRpcChannel
  private readonly reportSessionId?: string
  private readonly sessionFile?: string
  private stderr = ''

  constructor(options: WorkerProcessOptions) {
    this.definition = options.definition
    this.cwd = options.cwd
    this.extensionPaths = options.extensionPaths
    this.reportSessionId = options.reportSessionId
    this.sessionFile = options.sessionFile
    this.channel = new HowabandaRpcChannel({
      workerId: this.definition.id,
      onEvent: (event) => {
        for (const listener of this.eventListeners) {
          listener(event)
        }
      },
    })
  }

  get pid(): number | undefined {
    return this.process?.pid
  }

  getStderr(): string {
    return this.stderr
  }

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  onClose(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => void {
    this.closeListeners.add(listener)
    return () => {
      this.closeListeners.delete(listener)
    }
  }

  async start(): Promise<void> {
    if (this.process) {
      return
    }

    const options: WorkerProcessOptions = {
      definition: this.definition,
      cwd: this.cwd,
      extensionPaths: this.extensionPaths,
      reportSessionId: this.reportSessionId,
      sessionFile: this.sessionFile,
    }
    this.process = spawn('pi', buildWorkerProcessArgs(options), {
      cwd: this.cwd,
      env: buildWorkerEnvironment(options),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.process.stderr?.on('data', (chunk) => {
      this.stderr += chunk.toString()
    })
    this.channel.attach(this.process)
    this.process.on('close', (code, signal) => {
      this.channel.detachWithError(`exit code ${code ?? 'unknown'}`)
      this.process = null
      for (const listener of this.closeListeners) {
        listener(code, signal)
      }
    })

    await new Promise((resolve) => setTimeout(resolve, 150))
    if (this.process.exitCode !== null) {
      throw new Error(
        `Worker ${this.definition.id} exited immediately with code ${this.process.exitCode}`,
      )
    }
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return
    }

    try {
      await this.abort()
    } catch {
      // Ignore abort errors during shutdown.
    }

    const child = this.process
    child.kill('SIGTERM')

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 1_000)

      child.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  async prompt(message: string): Promise<void> {
    await this.send({ type: 'prompt', message })
  }

  async steer(message: string): Promise<void> {
    await this.send({ type: 'steer', message })
  }

  async followUp(message: string): Promise<void> {
    await this.send({ type: 'follow_up', message })
  }

  async abort(): Promise<void> {
    await this.send({ type: 'abort' })
  }

  async getState(): Promise<HowabandaRpcSessionState> {
    const response = await this.send({ type: 'get_state' })
    return response.data as HowabandaRpcSessionState
  }

  async getLastAssistantText(): Promise<string | null> {
    const response = await this.send({ type: 'get_last_assistant_text' })
    const data = response.data as { text: string | null }
    return data.text
  }

  async setSessionName(name: string): Promise<void> {
    await this.send({ type: 'set_session_name', name })
  }

  private async send(command: Omit<HowabandaRpcCommand, 'id'>) {
    if (!this.process) {
      throw new Error(`Worker ${this.definition.id} is not running`)
    }
    return await this.channel.send(this.process, command)
  }
}
