import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { registerClawasCommands } from './commands.js'
import { ClawasRuntime } from './runtime.js'

export default function clawasExtension(pi: ExtensionAPI): void {
  const runtime = new ClawasRuntime()

  registerClawasCommands(pi, runtime)

  const handleSessionStart = async (ctx: Parameters<ClawasRuntime['attach']>[0]) => {
    runtime.attach(ctx)
  }

  pi.on('session_start', async (event, ctx) => {
    // Pi 0.65.0 removed session_switch/session_fork in favor of reasoned
    // session_start events. We want the same runtime attach path for all start
    // reasons (startup, reload, new, resume, fork).
    void event
    await handleSessionStart(ctx)
  })

  pi.on('session_shutdown', async () => {
    await runtime.dispose()
  })
}
