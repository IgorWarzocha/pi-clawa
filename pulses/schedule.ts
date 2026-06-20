export type PulseSchedule =
  | { kind: 'interval'; everyMs: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; day: number; hour: number; minute: number }
  | { kind: 'at'; atMs: number }

const DURATION_PATTERN = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hour|hours|d|day|days)$/iu
const EVERY_PATTERN = /^every\s+(.+)$/iu
const DAILY_PATTERN = /^daily\s+(\d{1,2}):(\d{2})$/iu
const WEEKLY_PATTERN =
  /^weekly\s+(sun|mon|tue|wed|thu|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(\d{1,2}):(\d{2})$/iu
const AT_PATTERN = /^at\s+(.+)$/iu

const DAY_INDEX: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
}

function parseDurationMs(raw: string): number | null {
  const match = DURATION_PATTERN.exec(raw.trim())
  if (!match) return null
  const amount = Number(match[1])
  const unit = match[2]?.toLowerCase()
  if (!Number.isFinite(amount) || amount <= 0 || !unit) return null
  if (unit.startsWith('m')) return amount * 60_000
  if (unit === 'h' || unit === 'hr' || unit.startsWith('hour')) return amount * 3_600_000
  if (unit.startsWith('d')) return amount * 86_400_000
  return null
}

function validTime(hour: number, minute: number): boolean {
  return (
    Number.isInteger(hour) &&
    Number.isInteger(minute) &&
    hour >= 0 &&
    hour < 24 &&
    minute >= 0 &&
    minute < 60
  )
}

export function parsePulseSchedule(raw: string): PulseSchedule | null {
  const text = raw.trim()
  const every = EVERY_PATTERN.exec(text)
  if (every?.[1]) {
    const everyMs = parseDurationMs(every[1])
    return everyMs ? { kind: 'interval', everyMs } : null
  }

  const daily = DAILY_PATTERN.exec(text)
  if (daily?.[1] && daily[2]) {
    const hour = Number(daily[1])
    const minute = Number(daily[2])
    return validTime(hour, minute) ? { kind: 'daily', hour, minute } : null
  }

  const weekly = WEEKLY_PATTERN.exec(text)
  if (weekly?.[1] && weekly[2] && weekly[3]) {
    const day = DAY_INDEX[weekly[1].toLowerCase()]
    const hour = Number(weekly[2])
    const minute = Number(weekly[3])
    return day !== undefined && validTime(hour, minute)
      ? { kind: 'weekly', day, hour, minute }
      : null
  }

  const at = AT_PATTERN.exec(text)
  if (at?.[1]) {
    const atMs = Date.parse(at[1])
    return Number.isFinite(atMs) ? { kind: 'at', atMs } : null
  }

  return null
}

export function pulseDueKey(schedule: PulseSchedule, nowMs: number): string | null {
  const now = new Date(nowMs)
  if (schedule.kind === 'interval') return `interval:${Math.floor(nowMs / schedule.everyMs)}`
  if (schedule.kind === 'at') return nowMs >= schedule.atMs ? `at:${schedule.atMs}` : null

  const slot = new Date(now)
  slot.setHours(schedule.hour, schedule.minute, 0, 0)
  if (schedule.kind === 'daily') {
    return nowMs >= slot.getTime()
      ? `daily:${slot.toISOString().slice(0, 10)}:${schedule.hour}:${schedule.minute}`
      : null
  }

  const diff = (now.getDay() - schedule.day + 7) % 7
  slot.setDate(slot.getDate() - diff)
  if (nowMs < slot.getTime()) return null
  return `weekly:${slot.toISOString().slice(0, 10)}:${schedule.day}:${schedule.hour}:${schedule.minute}`
}

export function isPulseDue(options: {
  schedule: PulseSchedule
  nowMs: number
  firstSeenAt?: number | undefined
  lastRunAt?: number | undefined
  lastDueKey?: string | undefined
}): { due: boolean; dueKey: string | null } {
  if (!options.firstSeenAt) return { due: false, dueKey: null }

  if (options.schedule.kind === 'interval') {
    const last = options.lastRunAt ?? options.firstSeenAt
    return {
      due: options.nowMs - last >= options.schedule.everyMs,
      dueKey: pulseDueKey(options.schedule, options.nowMs),
    }
  }

  const dueKey = pulseDueKey(options.schedule, options.nowMs)
  return { due: Boolean(dueKey && dueKey !== options.lastDueKey), dueKey }
}
