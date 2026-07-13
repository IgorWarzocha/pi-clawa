import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { ensureDiscordConfig } from './env-file.js'
import { restartGateway, stopGateway } from './gateway.js'
import { handleEscape, handleMenuInput, handleTextInput } from './gui-input.js'
import {
  buildDiscordGuiItems,
  buildDiscordSetupGuidePrompt,
  buildDiscordSnapshot,
  saveDiscordInput,
} from './gui-model.js'
import { renderDiscordGui } from './gui-render.js'
import type { CustomView, DiscordGuiAction, DiscordGuiMode } from './gui-types.js'

export async function runDiscordGui(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  projectRoot: string,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify(`Discord config: ${ensureDiscordConfig(projectRoot)}`, 'info')
    return
  }

  await ctx.ui.custom<void>((tui, _theme, _keys, done): CustomView => {
    let snapshot = buildDiscordSnapshot(projectRoot)
    let items = buildDiscordGuiItems(snapshot)
    let selected = 0
    let mode: DiscordGuiMode = 'menu'
    let input = ''
    let message = ''
    let gatewayActionRunning = false

    const refresh = () => {
      snapshot = buildDiscordSnapshot(projectRoot)
      items = buildDiscordGuiItems(snapshot)
      selected = Math.min(selected, items.length - 1)
      tui.requestRender()
    }

    const saveInput = () => {
      const value = input.trim()
      input = ''
      if (!value) {
        message = 'nothing saved'
        mode = 'menu'
        refresh()
        return
      }
      saveDiscordInput({ mode, value, configPath: snapshot.configPath })
      message = 'token saved'
      mode = 'menu'
      refresh()
    }

    const openInputMode = (nextMode: 'token') => {
      mode = nextMode
      input = ''
      message = ''
      tui.requestRender()
    }

    const gatewayActions: Record<'restart' | 'stop', () => Promise<void>> = {
      restart: async () => {
        message = snapshot.tokenSet
          ? 'gateway restarting…'
          : 'token needed before gateway can start'
        refresh()
        await restartGateway(projectRoot, ctx)
        message = snapshot.tokenSet ? 'gateway started' : 'token needed before gateway can start'
      },
      stop: async () => {
        message = 'gateway stopping…'
        refresh()
        await stopGateway()
        message = 'gateway stopped'
      },
    }

    const runGatewayAction = async (action: 'restart' | 'stop') => {
      if (gatewayActionRunning) return
      gatewayActionRunning = true
      try {
        await gatewayActions[action]()
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      } finally {
        gatewayActionRunning = false
        refresh()
      }
    }

    const actionHandlers: Record<DiscordGuiAction, () => void> = {
      guide: () => {
        pi.sendUserMessage(buildDiscordSetupGuidePrompt())
        ctx.ui.notify('Sent Discord setup guide prompt.', 'info')
        done()
      },
      close: done,
      token: () => openInputMode('token'),
      restart: () => {
        void runGatewayAction('restart')
      },
      stop: () => {
        void runGatewayAction('stop')
      },
    }

    const activate = () => {
      const item = items[selected]
      if (!item) return
      actionHandlers[item.action]()
    }

    return {
      render: () => renderDiscordGui({ snapshot, items, selected, mode, input, message }),
      invalidate: refresh,
      handleInput(data: string) {
        if (
          handleEscape({
            data,
            mode,
            setMode: (value) => (mode = value),
            done,
            render: tui.requestRender,
          })
        ) {
          input = ''
          return
        }
        if (mode !== 'menu') {
          const result = handleTextInput({ data, input, render: tui.requestRender })
          input = result.input
          if (result.save) saveInput()
          return
        }
        const next = handleMenuInput({ data, selected, max: items.length - 1, activate })
        if (next !== selected) {
          selected = next
          tui.requestRender()
        }
      },
    }
  })
}
