import type { ChildProcess } from 'node:child_process'
import { type GatewayLockRecord, isGatewayProcessAlive } from '../shared/gateway-lock.js'

export type GatewayState =
  | { status: 'stopped' }
  | { status: 'starting'; projectRoot: string }
  | {
      status: 'running-owned'
      projectRoot: string
      lockPath: string
      process: ChildProcess
    }
  | {
      status: 'running-adopted'
      projectRoot: string
      lockPath: string
      lock: GatewayLockRecord
    }
  | { status: 'stopping'; projectRoot: string; pid: number }
  | { status: 'failed'; projectRoot: string; error: string }

let gatewayState: GatewayState = { status: 'stopped' }

export function getGatewayState(): GatewayState {
  return gatewayState
}

export function setGatewayState(state: GatewayState): void {
  gatewayState = state
}

export function isGatewayRunning(): boolean {
  if (gatewayState.status === 'running-owned') {
    return gatewayState.process.exitCode === null && gatewayState.process.signalCode === null
  }
  if (gatewayState.status === 'running-adopted') {
    return isGatewayProcessAlive(gatewayState.lock)
  }
  return gatewayState.status === 'starting' || gatewayState.status === 'stopping'
}
