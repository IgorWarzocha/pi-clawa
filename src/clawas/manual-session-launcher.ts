import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  buildInteractiveCommand,
  type LaunchOptions,
  sanitizeWindowName,
} from './manual-command.js'
import {
  asRecord,
  type HerdrContext,
  herdrBin,
  parseHerdrLayoutPanes,
  parseHerdrPaneFromResponse,
  parseHerdrResponse,
} from './manual-herdr.js'

const execFileAsync = promisify(execFile)
const WHITESPACE_SPLIT_REGEX = /\s+/

interface TmuxContext {
  windowTarget: string
  mainPaneId: string
}

/**
 * Opens worker sessions for direct human takeover.
 * Herdr is preferred when the main session is running in Herdr; tmux remains as
 * a fallback for older server sessions.
 */
export class ClawasManualSessionLauncher {
  private tmuxContext: TmuxContext | null = null
  private herdrContext: HerdrContext | null = null

  async captureCurrentHostPane(): Promise<void> {
    this.tmuxContext = null
    this.herdrContext = null

    if (process.env['HERDR_ENV'] === '1' && process.env['HERDR_PANE_ID']?.trim()) {
      await this.captureCurrentHerdrPane()
      if (this.herdrContext) {
        return
      }
    }

    await this.captureCurrentTmuxPane()
  }

  async captureCurrentTmuxPane(): Promise<void> {
    if (!process.env['TMUX']) {
      this.tmuxContext = null
      return
    }

    const result = await execFileAsync('tmux', ['display-message', '-p', '#S:#I\n#{pane_id}'])
    const [windowTarget, mainPaneId] = result.stdout.trim().split('\n')
    if (!(windowTarget && mainPaneId)) {
      this.tmuxContext = null
      return
    }

    this.tmuxContext = { windowTarget, mainPaneId }
  }

  async captureCurrentHerdrPane(): Promise<void> {
    const mainPaneId = process.env['HERDR_PANE_ID']?.trim()
    if (!mainPaneId) {
      this.herdrContext = null
      return
    }

    try {
      const result = await execFileAsync(herdrBin(), ['pane', 'current', '--pane', mainPaneId])
      const parsed = parseHerdrResponse(result.stdout)
      const pane = asRecord(asRecord(parsed['result'])?.['pane'])
      const paneId = typeof pane?.['pane_id'] === 'string' ? pane['pane_id'] : mainPaneId
      const workspaceId =
        typeof pane?.['workspace_id'] === 'string'
          ? pane['workspace_id']
          : process.env['HERDR_WORKSPACE_ID']?.trim() || undefined
      this.herdrContext = { mainPaneId: paneId, workspaceId }
    } catch {
      this.herdrContext = null
    }
  }

  canOpenPanel(): boolean {
    return !!this.herdrContext || !!this.tmuxContext
  }

  getHostLabel(): string | null {
    if (this.herdrContext) return 'Herdr'
    if (this.tmuxContext) return 'tmux'
    return null
  }

  async openPanel(options: LaunchOptions): Promise<string> {
    if (this.herdrContext) {
      return await this.openHerdrPanel(this.herdrContext, options)
    }
    if (this.tmuxContext) {
      return await this.openTmuxPanel(this.tmuxContext, options)
    }
    throw new Error(
      `${options.clawaDefaults.clawasName} manual takeover requires Herdr or tmux; open the main session inside one first`,
    )
  }

  async openWindow(options: LaunchOptions): Promise<string> {
    if (this.herdrContext) {
      return await this.openHerdrTab(this.herdrContext, options)
    }
    if (this.tmuxContext) {
      return await this.openTmuxWindow(this.tmuxContext, options)
    }
    throw new Error(
      `${options.clawaDefaults.clawasName} manual window mode requires Herdr or tmux; open the main session inside one first`,
    )
  }

  private async openHerdrPanel(context: HerdrContext, options: LaunchOptions): Promise<string> {
    const command = buildInteractiveCommand(options, true)
    const targetPane = await this.findLastRightHandHerdrPane(context)
    const splitArgs = targetPane
      ? [
          'pane',
          'split',
          '--pane',
          targetPane,
          '--direction',
          'down',
          '--cwd',
          options.cwd,
          '--focus',
        ]
      : [
          'pane',
          'split',
          '--pane',
          context.mainPaneId,
          '--direction',
          'right',
          '--ratio',
          '0.6',
          '--cwd',
          options.cwd,
          '--focus',
        ]
    const result = await execFileAsync(herdrBin(), splitArgs, {
      cwd: options.cwd,
    })
    const newPaneId = parseHerdrPaneFromResponse(result.stdout).pane_id

    await this.renameHerdrPane(newPaneId, options.definition.title)
    await execFileAsync(herdrBin(), ['pane', 'run', newPaneId, command], {
      cwd: options.cwd,
    })
    return newPaneId
  }

  private async openHerdrTab(context: HerdrContext, options: LaunchOptions): Promise<string> {
    const fallbackName = sanitizeWindowName(options.clawaDefaults.clawasName.toLowerCase(), 'clawa')
    const tabName = sanitizeWindowName(options.definition.title, fallbackName)
    const args = ['tab', 'create', '--cwd', options.cwd, '--label', tabName, '--focus']
    if (context.workspaceId) {
      args.splice(2, 0, '--workspace', context.workspaceId)
    }

    const result = await execFileAsync(herdrBin(), args, { cwd: options.cwd })
    const rootPaneId = parseHerdrPaneFromResponse(result.stdout).pane_id
    await execFileAsync(
      herdrBin(),
      ['pane', 'run', rootPaneId, buildInteractiveCommand(options, true)],
      { cwd: options.cwd },
    )
    return rootPaneId
  }

  private async renameHerdrPane(paneId: string, label: string): Promise<void> {
    try {
      await execFileAsync(herdrBin(), ['pane', 'rename', paneId, label])
    } catch {
      // Cosmetic only. Older Herdr builds may not support pane labels the same way.
    }
  }

  private async openTmuxPanel(context: TmuxContext, options: LaunchOptions): Promise<string> {
    const command = buildInteractiveCommand(options)
    const targetPane = await this.findLastRightHandTmuxPane(context)
    const splitArgs = targetPane
      ? [
          'split-window',
          '-v',
          '-c',
          options.cwd,
          '-P',
          '-F',
          '#{pane_id}',
          '-t',
          targetPane,
          command,
        ]
      : [
          'split-window',
          '-h',
          '-c',
          options.cwd,
          '-P',
          '-F',
          '#{pane_id}',
          '-t',
          context.mainPaneId,
          command,
        ]
    const result = await execFileAsync('tmux', splitArgs, { cwd: options.cwd })
    const newPaneId = result.stdout.trim()

    await execFileAsync('tmux', ['select-pane', '-t', context.mainPaneId])
    await execFileAsync('tmux', [
      'set-window-option',
      '-t',
      context.windowTarget,
      'main-pane-width',
      '60%',
    ])
    await execFileAsync('tmux', ['select-layout', '-t', context.windowTarget, 'main-vertical'])
    await execFileAsync('tmux', ['select-pane', '-t', newPaneId])
    return newPaneId
  }

  private async openTmuxWindow(_context: TmuxContext, options: LaunchOptions): Promise<string> {
    const fallbackName = sanitizeWindowName(options.clawaDefaults.clawasName.toLowerCase(), 'clawa')
    const windowName = sanitizeWindowName(options.definition.title, fallbackName)
    const command = buildInteractiveCommand(options)
    const result = await execFileAsync(
      'tmux',
      ['new-window', '-c', options.cwd, '-P', '-F', '#{window_id}', '-n', windowName, command],
      { cwd: options.cwd },
    )
    return result.stdout.trim()
  }

  private async findLastRightHandTmuxPane(context: TmuxContext): Promise<string | null> {
    const result = await execFileAsync('tmux', [
      'list-panes',
      '-t',
      context.windowTarget,
      '-F',
      '#{pane_id} #{pane_left} #{pane_top}',
    ])
    const rightHandPanes = result.stdout
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [paneId, left, top] = line.split(WHITESPACE_SPLIT_REGEX)
        return {
          paneId,
          left: Number(left),
          top: Number(top),
        }
      })
      .filter((pane) => pane.left > 0)
      .sort((left, right) => left.top - right.top)

    return rightHandPanes.at(-1)?.paneId ?? null
  }

  private async findLastRightHandHerdrPane(context: HerdrContext): Promise<string | null> {
    try {
      const result = await execFileAsync(herdrBin(), [
        'pane',
        'layout',
        '--pane',
        context.mainPaneId,
      ])
      const panes = parseHerdrLayoutPanes(result.stdout)
      const mainPane = panes.find((pane) => pane.pane_id === context.mainPaneId)
      if (!mainPane) {
        return null
      }

      const rightHandPanes = panes
        .filter((pane) => pane.pane_id !== context.mainPaneId && pane.rect.x > mainPane.rect.x)
        .sort((left, right) => left.rect.y - right.rect.y || left.rect.x - right.rect.x)

      return rightHandPanes.at(-1)?.pane_id ?? null
    } catch {
      return null
    }
  }
}
