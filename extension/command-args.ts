const SPACE_SPLIT_REGEX = /\s+/

export function resolveBootstrapRequest(args: string): boolean {
  const normalized = args.trim().toLowerCase()
  if (!normalized) return false
  return normalized === 'bootstrap' || normalized === 'bootstrap-standard'
}

export function resolveCreateRequest(args: string): {
  run: boolean
  purpose?: string
} {
  const trimmed = args.trim()
  if (!trimmed) return { run: false }

  const parts = trimmed.split(SPACE_SPLIT_REGEX).filter(Boolean)
  const first = parts[0]?.toLowerCase()
  if (first !== 'create' && first !== 'new') {
    return { run: false }
  }

  const purpose = parts.slice(1).join(' ').trim()
  return { run: true, purpose: purpose || undefined }
}
