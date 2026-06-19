import { promises as fs } from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'

const SOCKET_SUFFIX = '.sock'
const ALIAS_SUFFIX = '.alias'
const DEFAULT_CONTROL_SOCKET_DIR = 'howabanda-control'

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

export function getHowabandaControlDir(): string {
  const dirName = process.env.PI_HOWABANDA_CONTROL_SOCKET_DIR?.trim() || DEFAULT_CONTROL_SOCKET_DIR
  return path.join(os.homedir(), '.pi', dirName)
}

export function getSocketPath(sessionId: string): string {
  return path.join(getHowabandaControlDir(), `${sessionId}${SOCKET_SUFFIX}`)
}

function getAliasPath(alias: string): string {
  return path.join(getHowabandaControlDir(), `${alias}${ALIAS_SUFFIX}`)
}

export async function ensureControlDir(): Promise<void> {
  await fs.mkdir(getHowabandaControlDir(), { recursive: true })
}

export async function removeSocket(socketPath: string | null): Promise<void> {
  if (!socketPath) {
    return
  }

  try {
    await fs.unlink(socketPath)
  } catch (error) {
    if (isErrnoException(error) && error.code !== 'ENOENT') {
      throw error
    }
  }
}

export async function syncSocketAlias(sessionId: string, alias: string | undefined): Promise<void> {
  if (!alias) {
    return
  }

  const aliasPath = getAliasPath(alias)
  const target = `${sessionId}${SOCKET_SUFFIX}`
  try {
    await fs.unlink(aliasPath)
  } catch (error) {
    if (isErrnoException(error) && error.code !== 'ENOENT') {
      throw error
    }
  }

  try {
    await fs.symlink(target, aliasPath)
  } catch (error) {
    if (isErrnoException(error) && error.code !== 'EEXIST') {
      throw error
    }
  }
}

export async function removeAliasesForSocket(socketPath: string | null): Promise<void> {
  if (!socketPath) {
    return
  }

  const controlDir = getHowabandaControlDir()
  try {
    const entries = await fs.readdir(controlDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!(entry.isSymbolicLink() && entry.name.endsWith(ALIAS_SUFFIX))) {
        continue
      }

      const aliasPath = path.join(controlDir, entry.name)
      let target: string
      try {
        target = await fs.readlink(aliasPath)
      } catch {
        continue
      }

      if (path.resolve(controlDir, target) === socketPath) {
        await fs.unlink(aliasPath)
      }
    }
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return
    }
    throw error
  }
}

async function canConnectToSocket(socketPath: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection(socketPath)
    const finish = (value: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(value)
    }

    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(250, () => finish(false))
  })
}

async function cleanupDeadSocket(socketPath: string): Promise<void> {
  await removeAliasesForSocket(socketPath).catch(() => {})
  await removeSocket(socketPath).catch(() => {})
}

export async function resolveSocketPath(target: string): Promise<string | null> {
  if (!target) {
    return null
  }

  const directSocketPath = getSocketPath(target)
  try {
    await fs.access(directSocketPath)
    if (await canConnectToSocket(directSocketPath)) {
      return directSocketPath
    }
    await cleanupDeadSocket(directSocketPath)
  } catch {
    // Fall through to alias lookup.
  }

  const controlDir = getHowabandaControlDir()
  const aliasPath = getAliasPath(target)
  try {
    const symlinkTarget = await fs.readlink(aliasPath)
    const resolvedSocketPath = path.resolve(controlDir, symlinkTarget)
    try {
      await fs.access(resolvedSocketPath)
      if (await canConnectToSocket(resolvedSocketPath)) {
        return resolvedSocketPath
      }
      await cleanupDeadSocket(resolvedSocketPath)
      await fs.unlink(aliasPath).catch(() => {})
      return null
    } catch {
      // Alias files can outlive the actual socket after an abrupt pane/session
      // close. Prune the dead alias here so manual-session recovery can observe
      // reality instead of getting stuck behind stale control-plane breadcrumbs.
      await fs.unlink(aliasPath).catch(() => {})
      return null
    }
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return null
    }
    return null
  }
}
