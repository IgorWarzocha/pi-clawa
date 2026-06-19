import type { Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { visibleWidth } from '@earendil-works/pi-tui'
import type { BurrowDefaults } from '../config'
import type { HowabandaMonitorState } from './monitor-state.js'
import { renderMonitorLines } from './render-feed.js'
import type { HowabandaState } from './types.js'

export class HowabandaOverlay implements Component {
  private readonly theme: Theme
  private readonly getState: () => HowabandaState
  private readonly getMonitorState: () => HowabandaMonitorState
  private readonly getNow: () => number
  private readonly burrowDefaults: BurrowDefaults

  constructor(
    theme: Theme,
    getState: () => HowabandaState,
    getMonitorState: () => HowabandaMonitorState,
    getNow: () => number,
    burrowDefaults: BurrowDefaults,
  ) {
    this.theme = theme
    this.getState = getState
    this.getMonitorState = getMonitorState
    this.getNow = getNow
    this.burrowDefaults = burrowDefaults
  }

  render(width: number): string[] {
    return renderMonitorLines(
      this.getState(),
      this.getMonitorState(),
      this.getNow(),
      this.theme,
      width,
      this.burrowDefaults,
    ).map((line) => {
      const padding = Math.max(0, width - visibleWidth(line))
      return line + ' '.repeat(padding)
    })
  }

  invalidate(): void {}
}
