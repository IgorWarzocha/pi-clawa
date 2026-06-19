import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import type { BurrowDefaults } from '../config'
import type { HowabandaMonitorState } from './monitor-state.js'
import { HowabandaOverlay } from './overlay.js'
import type { HowabandaState } from './types.js'

const EMPTY_STATE: HowabandaState = {
  workers: [],
  events: [],
  nextEventId: 1,
  daemonStarted: false,
}

/**
 * Keeps the HOWABANDA monitor widget wiring in one place.
 */
export class HowabandaUiBridge {
  showMonitor(
    context: ExtensionContext,
    getState: () => HowabandaState | null | undefined,
    getMonitorState: () => HowabandaMonitorState,
    burrowDefaults: BurrowDefaults,
  ): void {
    context.ui.setWidget(
      'howabanda-monitor',
      (_tui, theme: Theme) =>
        new HowabandaOverlay(
          theme,
          () => getState() ?? EMPTY_STATE,
          getMonitorState,
          () => Date.now(),
          burrowDefaults,
        ),
      { placement: 'aboveEditor' },
    )
  }

  hideMonitor(context: ExtensionContext): void {
    context.ui.setWidget('howabanda-monitor', undefined)
    context.ui.setWidget('howabanda-feed', undefined)
  }

  clear(context: ExtensionContext): void {
    this.hideMonitor(context)
    context.ui.setHeader(undefined)
    context.ui.setStatus('howabanda', undefined)
  }
}
