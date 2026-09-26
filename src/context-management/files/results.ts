export function boundedRows<A>(rows: readonly A[], maximumBytes = 16_000) {
  const kept: A[] = []
  for (const row of rows) {
    if (Buffer.byteLength(JSON.stringify([...kept, row]), 'utf8') > maximumBytes) break
    kept.push(row)
  }
  return { rows: kept, truncated: kept.length < rows.length }
}

export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

export function utf8Prefix(text: string, maximumBytes: number): string {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.byteLength <= maximumBytes) return text
  return new TextDecoder().decode(bytes.subarray(0, maximumBytes), { stream: true })
}

export function truncateSearchLine(line: string, query: string, maximumBytes: number) {
  if (Buffer.byteLength(line, 'utf8') <= maximumBytes) return { text: line, truncated: false }
  const matchIndex = line.indexOf(query)
  const queryBytes = Buffer.byteLength(query, 'utf8')
  const flankBytes = Math.max(0, Math.floor((maximumBytes - queryBytes) / 2))
  const beforeBytes = Buffer.from(line.slice(0, matchIndex), 'utf8')
  let start = Math.max(0, beforeBytes.byteLength - flankBytes)
  while (start < beforeBytes.byteLength && (beforeBytes[start] ?? 0) >> 6 === 2) start += 1
  const before = new TextDecoder().decode(beforeBytes.subarray(start))
  const afterBudget = Math.max(0, maximumBytes - Buffer.byteLength(before, 'utf8') - queryBytes)
  const after = utf8Prefix(line.slice(matchIndex + query.length), afterBudget)
  return { text: `${before}${query}${after}`, truncated: true }
}
