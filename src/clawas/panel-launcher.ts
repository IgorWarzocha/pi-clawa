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
  | { host: 'herdr'; workspaceId: string; session: string }
  | { host: 'tmux'; socket: string; serverPid: string }

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

/** One named Herdr tab or tmux window per Clawa; the host owns its process lifetime. */
export class ClawasPanelLauncher {
  private context: Host | null = null

  async captureCurrentHost(): Promise<void> {
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
        workspaceId: herdrId(pane, 'workspace_id'),
        session,
      }
      return
    }
    const socket = process.env['TMUX']?.split(',')[0]
    if (!socket) return
    const serverPid = await this.tmuxServer(socket)
    if (!serverPid) throw new Error('tmux did not identify the current server')
    this.context = { host: 'tmux', socket, serverPid }
  }

  canOpenTab(): boolean {
    return this.context !== null
  }

  async open(options: LaunchOptions): Promise<PanelHandle> {
    const context = this.context
    if (!context) throw new Error(`${options.clawaDefaults.clawasName} requires Herdr or tmux`)
    const args = panelArgs(options)
    const env = panelEnvironment(options)
    if (context.host === 'herdr') return this.openHerdr(context, options, args, env)
    return this.openTmux(context, options, args, env)
  }

  private async openHerdr(
    context: Extract<Host, { host: 'herdr' }>,
    options: LaunchOptions,
    args: string[],
    env: Record<string, string>,
  ): Promise<PanelHandle> {
    const environment = Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`])
    const created = await herdr(
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
        '--no-focus',
      ],
      context.session,
    )
    const pane = herdrObject(created['root_pane'], 'created pane')
    const paneId = herdrId(pane, 'pane_id')
    const tabId = herdrId(herdrObject(created['tab'], 'created tab'), 'tab_id')
    const undo = async () => {
      await herdr(['tab', 'close', tabId], context.session)
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
  ): Promise<PanelHandle> {
    if ((await this.tmuxServer(context.socket)) !== context.serverPid)
      throw new Error('tmux server changed')
    const command = `${Object.entries(env)
      .map(([key, value]) => `${key}=${shellQuote(value)}`)
      .join(' ')} exec pi ${args.map(shellQuote).join(' ')}`
    const output = await tmux(context.socket, [
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
    ])
    const [paneId, panePid] = output.split(' ')
    if (!(paneId && panePid)) throw new Error(`tmux did not identify created pane: ${output}`)
    return {
      host: 'tmux',
      paneId,
      panePid,
      socket: context.socket,
      serverPid: context.serverPid,
      sessionFile: options.sessionFile,
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
    if (!(await this.isAlive(handle))) throw new Error('Clawa tab is no longer running')
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
      // The user may have split the tab since launch; preserve any other occupants.
      const tab = herdrObject(
        (await herdr(['tab', 'get', handle.tabId], handle.session))['tab'],
        'tab',
      )
      if (tab['pane_count'] === 1) {
        await herdr(['tab', 'close', handle.tabId], handle.session)
      } else {
        await herdr(['pane', 'close', handle.paneId], handle.session)
      }
    } else {
      await tmux(handle.socket, ['kill-pane', '-t', handle.paneId])
    }
  }
}
