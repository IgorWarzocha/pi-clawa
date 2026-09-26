import { spawn } from 'node:child_process'
import { contentRoot, throwIfAborted } from './storage.ts'

interface LockProcessStatus {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly error?: Error
}

export async function withWriteLock<A>(
  root: string,
  signal: AbortSignal,
  operation: () => Promise<A>,
): Promise<A> {
  throwIfAborted(signal)
  const lockRoot = await contentRoot(root)
  throwIfAborted(signal)
  const child = spawn(
    'flock',
    ['--exclusive', '--', lockRoot, 'sh', '-c', "printf 'acquired\\n'; cat >/dev/null"],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  child.stdin.on('error', () => undefined)
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < 4_096) stderr += chunk
  })
  const exited = new Promise<LockProcessStatus>((resolve) => {
    child.once('error', (error) => resolve({ code: null, signal: null, error }))
    child.once('close', (code, exitSignal) => resolve({ code, signal: exitSignal }))
  })
  const acquired = new Promise<void>((resolve, reject) => {
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      if (output.includes('\n')) resolve()
    })
    child.once('error', reject)
    child.once('close', (code, exitSignal) =>
      reject(
        new Error(
          `File write lock exited before acquisition (${code ?? exitSignal ?? 'unknown'})${stderr === '' ? '' : `: ${stderr.trim()}`}`,
        ),
      ),
    )
  })
  const abort = () => child.kill('SIGTERM')
  signal.addEventListener('abort', abort, { once: true })
  try {
    await acquired
  } catch (cause) {
    child.kill('SIGTERM')
    await exited
    if (signal.aborted) throw abortError(signal)
    throw cause
  } finally {
    signal.removeEventListener('abort', abort)
  }

  if (signal.aborted) {
    child.stdin.end()
    await exited
    throw abortError(signal)
  }
  const outcome = await Promise.resolve()
    .then(operation)
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
  child.stdin.end()
  const status = await exited
  if (!outcome.ok) throw outcome.error
  if (status.error !== undefined || status.code !== 0) {
    throw new Error(
      status.error === undefined
        ? `File write lock failed (${status.code ?? status.signal ?? 'unknown'})`
        : `File write lock failed: ${status.error.message}`,
    )
  }
  return outcome.value
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('File write interrupted', 'AbortError')
}
