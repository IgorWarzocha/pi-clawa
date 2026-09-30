import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'

/** Mask only our tools. Never restore or replace another extension's selected tool set. */
export function registerClawaToolAvailability(
  pi: ExtensionAPI,
  tools: ToolDefinition[],
  isActive: () => boolean,
): void {
  const names = new Set(tools.map((tool) => tool.name))
  const hideDormantTools = (): void => {
    if (isActive()) return
    const active = pi.getActiveTools()
    const remaining = active.filter((name) => !names.has(name))
    if (remaining.length !== active.length) pi.setActiveTools(remaining)
  }
  pi.on('session_start', hideDormantTools)
  pi.on('before_agent_start', (event) => {
    hideDormantTools()
    if (!isActive())
      event.systemPromptOptions.selectedTools = event.systemPromptOptions.selectedTools.filter(
        (name) => !names.has(name),
      )
  })
  pi.on('tool_call', (event) => {
    if (!isActive() && names.has(event.toolName))
      return { block: true, reason: 'Clawa is not active in this session' }
    return undefined
  })
}

export async function registerClawaCodeModeTools(
  pi: ExtensionAPI,
  tools: ToolDefinition[],
  isActive: () => boolean,
): Promise<void> {
  try {
    import.meta.resolve('@howaboua/pi-codex-conversion/code-mode')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND') return
    throw error
  }
  const { adaptToolForCodeMode, registerCodeModeExtensionTools } = await import(
    '@howaboua/pi-codex-conversion/code-mode'
  )
  const adapted = tools.map((tool) =>
    adaptToolForCodeMode(tool, {
      usage: `await tools.${tool.name}(input) // ${tool.description}`,
      deferLoading: true,
      promptMetadata: false,
    }),
  )
  const registration = registerCodeModeExtensionTools(pi, () => adapted, { isActive })
  pi.on('session_start', () => registration.refresh())
  pi.on('session_shutdown', (event) => {
    if (event.reason === 'quit' || event.reason === 'reload') registration.unregister()
  })
}
