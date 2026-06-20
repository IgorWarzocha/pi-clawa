import type { ChildProcess } from 'node:child_process'

let gatewayProcess: ChildProcess | null = null
let gatewayConfigPath: string | null = null

export function getGatewayProcess(): ChildProcess | null {
  return gatewayProcess
}

export function setGatewayProcess(process: ChildProcess | null): void {
  gatewayProcess = process
}

export function getGatewayConfigPath(): string | null {
  return gatewayConfigPath
}

export function setGatewayConfigPath(path: string | null): void {
  gatewayConfigPath = path
}

export function isGatewayRunning(): boolean {
  return Boolean(gatewayProcess && !gatewayProcess.killed)
}
