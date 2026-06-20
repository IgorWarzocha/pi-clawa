import type { Theme } from '@earendil-works/pi-coding-agent'
import { truncateToWidth } from '@earendil-works/pi-tui'
import type { ClawaDefaults } from '../config'
import { type ClawasMonitorState, clampMonitorWorkerIndex } from './monitor-state.js'
import { getSpinnerFrame } from './spinner.js'
import type { ClawasState, WorkerState } from './types.js'

function getStatusIcon(worker: WorkerState, now: number, theme: Theme): string {
  switch (worker.status) {
    case 'starting':
      return theme.fg('accent', '◔')
    case 'idle':
      return theme.fg('dim', '◌')
    case 'streaming':
      return theme.fg('accent', getSpinnerFrame(now))
    case 'stopped':
      return theme.fg('dim', '○')
    case 'error':
      return theme.fg('error', '●')
    default:
      return theme.fg('dim', '○')
  }
}

function getDetailSegments(worker: WorkerState, theme: Theme): string[] {
  const segments: string[] = []

  if (worker.currentTask) {
    segments.push(
      theme.fg(
        isBusy(worker) ? 'accent' : worker.status === 'stopped' ? 'dim' : 'muted',
        worker.currentTask,
      ),
    )
  } else if (worker.status === 'stopped' && worker.lastSummary === 'not started yet') {
    segments.push(theme.fg('dim', 'not started'))
  } else {
    segments.push(theme.fg('dim', 'idle'))
  }

  if (worker.status === 'error') {
    segments.push(theme.fg('muted', worker.lastError ?? worker.lastSummary))
    return segments
  }

  if (worker.currentToolName) {
    segments.push(theme.fg('muted', `tool ${worker.currentToolName}`))
  }

  return segments
}

function renderWorkerRow(worker: WorkerState, now: number, theme: Theme): string {
  const icon = getStatusIcon(worker, now, theme)
  const emoji = worker.definition.emoji ? `${worker.definition.emoji} ` : ''
  const title = isBusy(worker)
    ? theme.fg('accent', theme.bold(worker.definition.title))
    : theme.bold(worker.definition.title)
  const details = getDetailSegments(worker, theme)
  return details.length > 0
    ? `${icon} ${emoji}${title} · ${details.join(' · ')}`
    : `${icon} ${emoji}${title}`
}

function isLive(worker: WorkerState): boolean {
  return (
    worker.manualSession === true ||
    worker.status === 'starting' ||
    worker.status === 'streaming' ||
    worker.status === 'idle'
  )
}

function isBusy(worker: WorkerState): boolean {
  return worker.status === 'starting' || worker.status === 'streaming'
}

function renderSlot(index: number, active: boolean, theme: Theme): string {
  const label = active ? `[${index + 1}]` : String(index + 1)
  return theme.fg(active ? 'accent' : 'dim', label)
}

function renderMonitorFooter(workerCount: number, folded: boolean, theme: Theme): string {
  const targetHint = workerCount > 1 ? '/steer [n] message' : '/steer message'
  const jumpHint = workerCount > 1 ? '/jump [n]' : '/jump'
  const foldHint = folded ? 'alt+w open' : 'alt+w fold'
  const cycleHint = workerCount > 1 ? 'alt+q/e cycle · ' : ''
  return `${theme.fg('muted', '╰─')} ${theme.fg('dim', `${targetHint} · ${jumpHint} · ${cycleHint}${foldHint} · /claw manage`)}`
}

export function renderMonitorLines(
  state: ClawasState,
  monitor: ClawasMonitorState,
  now: number,
  theme: Theme,
  width: number,
  clawaDefaults: ClawaDefaults,
): string[] {
  const workers = state.workers
  const activeIndex = clampMonitorWorkerIndex(monitor.activeWorkerIndex, workers.length)
  const activeWorker = workers[activeIndex]
  const liveWorkers = workers.filter(isLive).length
  const busyWorkers = workers.filter(isBusy).length
  const activeLabel = activeWorker
    ? ` · active ${activeIndex + 1}:${activeWorker.definition.title}`
    : ''
  const busyLabel = busyWorkers > 0 ? ` · ${busyWorkers} busy` : ''
  const header = `${theme.fg('accent', '╭─')} ${theme.bold(theme.fg('accent', clawaDefaults.clawasName))} ${theme.fg('dim', `${liveWorkers}/${workers.length} live${busyLabel}${activeLabel}`)}`
  const lines = [truncateToWidth(header, width)]

  if (workers.length === 0) {
    lines.push(
      truncateToWidth(
        `${theme.fg('muted', '│')} ${theme.fg('dim', 'no workers configured')}`,
        width,
      ),
    )
    lines.push(truncateToWidth(renderMonitorFooter(workers.length, monitor.folded, theme), width))
    return lines
  }

  if (!monitor.folded) {
    for (const [index, worker] of workers.entries()) {
      const slot = renderSlot(index, index === activeIndex, theme)
      const line = `${theme.fg('muted', '│')} ${slot} ${renderWorkerRow(worker, now, theme)}`
      lines.push(truncateToWidth(line, width))
    }
  }

  lines.push(truncateToWidth(renderMonitorFooter(workers.length, monitor.folded, theme), width))
  return lines
}
