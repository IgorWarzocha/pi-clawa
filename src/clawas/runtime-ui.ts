import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import type { ClawaDefaults } from '../config'
import type { ClawasMonitorState } from './monitor-state.js'
import { ClawasOverlay } from './overlay.js'
import type { ClawasState } from './types.js'

const EMPTY_STATE: ClawasState = {
  workers: [],
  events: [],
  nextEventId: 1,
  daemonStarted: false,
}

/**
 * Keeps the Clawas monitor widget wiring in one place.
 */
export class ClawasUiBridge {
  showMonitor(
    context: ExtensionContext,
    getState: () => ClawasState | null | undefined,
    getMonitorState: () => ClawasMonitorState,
    clawaDefaults: ClawaDefaults,
  ): void {
    context.ui.setWidget(
      'clawas-monitor',
      (_tui, theme: Theme) =>
        new ClawasOverlay(
          theme,
          () => getState() ?? EMPTY_STATE,
          getMonitorState,
          () => Date.now(),
          clawaDefaults,
        ),
      { placement: 'aboveEditor' },
    )
  }

  hideMonitor(context: ExtensionContext): void {
    context.ui.setWidget('clawas-monitor', undefined)
    context.ui.setWidget('clawas-feed', undefined)
  }

  clear(context: ExtensionContext): void {
    this.hideMonitor(context)
    context.ui.setHeader(undefined)
    context.ui.setStatus('clawas', undefined)
  }
}
