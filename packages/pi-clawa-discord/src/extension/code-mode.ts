import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { registerDiscordHistoryTool } from './history-tool.js'
import type { registerDiscordTool } from './tool.js'

export async function registerDiscordCodeModeTools(
  pi: ExtensionAPI,
  send: ReturnType<typeof registerDiscordTool>,
  history: ReturnType<typeof registerDiscordHistoryTool>,
): Promise<void> {
  // Pi Codex is optional. Only absence is optional; a broken installed integration must fail visibly.
  try {
    import.meta.resolve('@howaboua/pi-codex-conversion/code-mode')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND') return
    throw error
  }
  const { adaptToolForCodeMode, registerCodeModeExtensionTools } = await import(
    '@howaboua/pi-codex-conversion/code-mode'
  )
  const registration = registerCodeModeExtensionTools(pi, () => [
    adaptToolForCodeMode(send, {
      usage:
        'await tools.discord_send(input) // Discord delivery; full input schema in tool metadata',
      deferLoading: true,
      promptMetadata: false,
      resultValue: (result) => result.details,
    }),
    adaptToolForCodeMode(history, {
      usage:
        'await tools.discord_history({ query?: string, speaker?: string, channel?: string, role?: "user" | "assistant" | "reaction", around?: number, limit?: number })',
      promptMetadata: false,
      resultValue: (result) => result.details,
    }),
  ])
  pi.on('session_shutdown', () => registration.unregister())
}
