import type { Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { visibleWidth } from '@earendil-works/pi-tui'
import type { ClawaDefaults } from '../config'
import type { ClawasMonitorState } from './monitor-state.js'
import { renderMonitorLines } from './render-feed.js'
import type { ClawasState } from './types.js'

export class ClawasOverlay implements Component {
  private readonly theme: Theme
  private readonly getState: () => ClawasState
  private readonly getMonitorState: () => ClawasMonitorState
  private readonly getNow: () => number
  private readonly clawaDefaults: ClawaDefaults

  constructor(
    theme: Theme,
    getState: () => ClawasState,
    getMonitorState: () => ClawasMonitorState,
    getNow: () => number,
    clawaDefaults: ClawaDefaults,
  ) {
    this.theme = theme
    this.getState = getState
    this.getMonitorState = getMonitorState
    this.getNow = getNow
    this.clawaDefaults = clawaDefaults
  }

  render(width: number): string[] {
    return renderMonitorLines(
      this.getState(),
      this.getMonitorState(),
      this.getNow(),
      this.theme,
      width,
      this.clawaDefaults,
    ).map((line) => {
      const padding = Math.max(0, width - visibleWidth(line))
      return line + ' '.repeat(padding)
    })
  }

  invalidate(): void {}
}
