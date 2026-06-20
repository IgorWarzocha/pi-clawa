import type { ClawaDefaults } from '../config'
import type { ClawasDaemon } from './daemon.js'
import type { ClawasManualSessionLauncher } from './manual-session-launcher.js'

export async function openWorkerManualSession(options: {
  mode: 'panel' | 'window'
  workerId: string
  daemon: ClawasDaemon
  launcher: ClawasManualSessionLauncher
  clawaDefaults: ClawaDefaults
  getExtensionPaths: (workerId?: string) => string[]
  render: () => void
}): Promise<string> {
  const definition = options.daemon.getWorkerDefinition(options.workerId)
  const cwd = options.daemon.getWorkerCwd(options.workerId)
  const sessionFile = await options.daemon.getWorkerSessionFile(options.workerId)

  await options.daemon.stopWorker(options.workerId)
  try {
    const launchOptions = {
      definition,
      cwd,
      extensionPaths: options.getExtensionPaths(options.workerId),
      clawaDefaults: options.clawaDefaults,
      sessionFile,
    }
    const handle =
      options.mode === 'panel'
        ? await options.launcher.openPanel(launchOptions)
        : await options.launcher.openWindow(launchOptions)
    await options.daemon.markWorkerDetached(options.workerId, 'manual session')
    options.render()
    return handle
  } catch (error) {
    await options.daemon.ensureWorkerRunning(options.workerId)
    options.render()
    throw new Error(
      `Failed to open manual ${options.mode} for ${definition.title}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
