import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { type LaunchOptions, panelArgs, panelEnvironment, shellQuote } from './panel-command.js'
import {
  HerdrResponseError,
  herdrId,
  herdrObject,
  herdrResult,
  type PanelHandle,
} from './panel-host.js'

const exec = promisify(execFile)

type Host =
  | { host: 'herdr'; paneId: string; workspaceId: string; session: string }
  | { host: 'tmux'; paneId: string; socket: string; serverPid: string }

const herdrBin = () => process.env['HERDR_BIN_PATH']?.trim() || 'herdr'

async function herdr(args: string[], session: string): Promise<Record<string, unknown>> {
  try {
    const { stdout } = await exec(herdrBin(), args, {
      env: { ...process.env, HERDR_SOCKET_PATH: session },
    })
    return herdrResult(stdout)
  } catch (error) {
    // Herdr reports API failures as JSON on stderr with a nonzero CLI exit status.
    if (
      error instanceof Error &&
      'stderr' in error &&
      typeof error.stderr === 'string' &&
      error.stderr.trimStart().startsWith('{')
    ) {
      return herdrResult(error.stderr)
    }
    throw error
  }
}

async function tmux(socket: string, args: string[]): Promise<string> {
  return (await exec('tmux', ['-S', socket, ...args])).stdout.trim()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function rollback(undo: () => Promise<void>, error: unknown): Promise<never> {
  try {
    await undo()
  } catch (cleanupError) {
    throw new Error(`${errorMessage(error)}; rollback also failed: ${errorMessage(cleanupError)}`, {
      cause: error,
    })
  }
  throw error
}

/** Native terminal hosts own placement, process lifetime, and user focus. */
export class ClawasPanelLauncher {
  private context: Host | null = null

  async captureCurrentHostPane(): Promise<void> {
    this.context = null
    const paneId = process.env['HERDR_PANE_ID']?.trim()
    if (process.env['HERDR_ENV'] === '1' && paneId) {
      const session = process.env['HERDR_SOCKET_PATH']?.trim()
      if (!session) throw new Error('Herdr pane has no socket identity')
      const pane = herdrObject(
        (await herdr(['pane', 'current', '--pane', paneId], session))['pane'],
        'current pane',
      )
      this.context = {
        host: 'herdr',
        paneId: herdrId(pane, 'pane_id'),
        workspaceId: herdrId(pane, 'workspace_id'),
        session,
      }
      return
    }
    const socket = process.env['TMUX']?.split(',')[0]
    if (!socket) return
    const [currentPane, serverPid] = (
      await tmux(socket, ['display-message', '-p', '#{pane_id}\n#{pid}'])
    ).split('\n')
    if (!(currentPane && serverPid)) throw new Error('tmux did not identify the current pane')
    this.context = { host: 'tmux', paneId: currentPane, socket, serverPid }
  }

  canOpenPanel(): boolean {
    return this.context !== null
  }

  getHostLabel(): string | null {
    return this.context?.host === 'herdr' ? 'Herdr' : this.context ? 'tmux' : null
  }

  async open(
    options: LaunchOptions,
    mode: 'panel' | 'window',
    focus = false,
  ): Promise<PanelHandle> {
    const context = this.context
    if (!context) throw new Error(`${options.clawaDefaults.clawasName} requires Herdr or tmux`)
    const args = panelArgs(options)
    const env = panelEnvironment(options)
    if (context.host === 'herdr') return this.openHerdr(context, options, args, env, mode, focus)
    return this.openTmux(context, options, args, env, mode, focus)
  }

  private async openHerdr(
    context: Extract<Host, { host: 'herdr' }>,
    options: LaunchOptions,
    args: string[],
    env: Record<string, string>,
    mode: 'panel' | 'window',
    focus: boolean,
  ): Promise<PanelHandle> {
    const environment = Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`])
    const created =
      mode === 'window'
        ? await herdr(
            [
              'tab',
              'create',
              '--workspace',
              context.workspaceId,
              '--cwd',
              options.cwd,
              '--label',
              options.definition.title,
              ...environment,
              focus ? '--focus' : '--no-focus',
            ],
            context.session,
          )
        : await herdr(
            [
              'pane',
              'split',
              '--pane',
              context.paneId,
              '--direction',
              'right',
              '--cwd',
              options.cwd,
              ...environment,
              focus ? '--focus' : '--no-focus',
            ],
            context.session,
          )
    const pane = herdrObject(created[mode === 'window' ? 'root_pane' : 'pane'], 'created pane')
    const paneId = herdrId(pane, 'pane_id')
    const tabId =
      mode === 'window'
        ? herdrId(herdrObject(created['tab'], 'created tab'), 'tab_id')
        : herdrId(pane, 'tab_id')
    const undo = async () => {
      await herdr(
        mode === 'window' ? ['tab', 'close', tabId] : ['pane', 'close', paneId],
        context.session,
      )
    }
    try {
      // Herdr waits for Pi to become interactive and supplies its own process supervision.
      const name = `clawa-${randomUUID().slice(0, 20)}`
      const started = await herdr(
        ['agent', 'start', name, '--kind', 'pi', '--pane', paneId, '--', ...args],
        context.session,
      )
      const agent = herdrObject(started['agent'], 'started agent')
      if (herdrId(agent, 'pane_id') !== paneId)
        throw new Error('Herdr started Pi in a different pane')
      return {
        host: 'herdr',
        paneId,
        tabId,
        terminalId: herdrId(agent, 'terminal_id'),
        agentName: name,
        sessionFile: options.sessionFile,
        window: mode === 'window',
        session: context.session,
      }
    } catch (error) {
      return rollback(undo, error)
    }
  }

  private async tmuxServer(socket: string): Promise<string> {
    return tmux(socket, ['display-message', '-p', '#{pid}'])
  }

  private async openTmux(
    context: Extract<Host, { host: 'tmux' }>,
    options: LaunchOptions,
    args: string[],
    env: Record<string, string>,
    mode: 'panel' | 'window',
    focus: boolean,
  ): Promise<PanelHandle> {
    if ((await this.tmuxServer(context.socket)) !== context.serverPid)
      throw new Error('tmux server changed')
    const command = `${Object.entries(env)
      .map(([key, value]) => `${key}=${shellQuote(value)}`)
      .join(' ')} exec pi ${args.map(shellQuote).join(' ')}`
    const create =
      mode === 'window'
        ? [
            'new-window',
            '-d',
            '-c',
            options.cwd,
            '-n',
            options.definition.title,
            '-P',
            '-F',
            '#{pane_id} #{pane_pid}',
            command,
          ]
        : [
            'split-window',
            '-d',
            '-t',
            context.paneId,
            '-c',
            options.cwd,
            '-P',
            '-F',
            '#{pane_id} #{pane_pid}',
            command,
          ]
    const output = await tmux(context.socket, create)
    const [paneId, panePid] = output.split(' ')
    if (!(paneId && panePid)) throw new Error(`tmux did not identify created pane: ${output}`)
    const handle: PanelHandle = {
      host: 'tmux',
      paneId,
      panePid,
      socket: context.socket,
      serverPid: context.serverPid,
      sessionFile: options.sessionFile,
    }
    try {
      if (focus) await this.focus(handle)
      return handle
    } catch (error) {
      return rollback(async () => {
        await this.close(handle)
      }, error)
    }
  }

  async isAlive(handle: PanelHandle): Promise<boolean> {
    if (handle.host === 'herdr') {
      try {
        const pane = herdrObject(
          (await herdr(['agent', 'get', handle.paneId], handle.session))['agent'],
          'agent',
        )
        // The unique Herdr name follows this process even if Pi changes session files.
        return (
          pane['terminal_id'] === handle.terminalId &&
          pane['name'] === handle.agentName &&
          pane['agent'] === 'pi'
        )
      } catch (error) {
        // Only a missing pane is stale. An unreachable server must not erase a persisted handle.
        if (
          error instanceof HerdrResponseError &&
          (error.code === 'pane_not_found' || error.code === 'agent_not_found')
        )
          return false
        throw error
      }
    }
    if ((await this.tmuxServer(handle.socket)) !== handle.serverPid) return false
    const output = await tmux(handle.socket, [
      'list-panes',
      '-a',
      '-F',
      '#{pane_id} #{pane_pid} #{pane_dead}',
    ])
    return output.split('\n').some((line) => line === `${handle.paneId} ${handle.panePid} 0`)
  }

  async focus(handle: PanelHandle): Promise<void> {
    if (!(await this.isAlive(handle))) throw new Error('Clawa panel is no longer running')
    if (handle.host === 'herdr') {
      await herdr(['agent', 'focus', handle.paneId], handle.session)
    } else {
      const windowId = await tmux(handle.socket, [
        'display-message',
        '-p',
        '-t',
        handle.paneId,
        '#{window_id}',
      ])
      await tmux(handle.socket, ['select-window', '-t', windowId])
      await tmux(handle.socket, ['select-pane', '-t', handle.paneId])
    }
  }

  async close(handle: PanelHandle): Promise<void> {
    if (!(await this.isAlive(handle))) return
    if (handle.host === 'herdr') {
      // A window may have acquired other panes since launch; close only our occupant then.
      const tab = herdrObject(
        (await herdr(['tab', 'get', handle.tabId], handle.session))['tab'],
        'tab',
      )
      if (handle.window && tab['pane_count'] === 1) {
        await herdr(['tab', 'close', handle.tabId], handle.session)
      } else {
        await herdr(['pane', 'close', handle.paneId], handle.session)
      }
    } else {
      await tmux(handle.socket, ['kill-pane', '-t', handle.paneId])
    }
  }
}
