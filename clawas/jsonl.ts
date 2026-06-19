import type { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

export function serializeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

export function attachJsonlLineReader(
  stream: Readable,
  onLine: (line: string) => void,
): () => void {
  const decoder = new StringDecoder('utf8')
  let buffer = ''

  const onData = (chunk: Buffer | string): void => {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk)

    while (true) {
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex === -1) {
        break
      }

      let line = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      if (line.endsWith('\r')) {
        line = line.slice(0, -1)
      }
      onLine(line)
    }
  }

  const onEnd = (): void => {
    buffer += decoder.end()
    if (buffer.length === 0) {
      return
    }

    const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
    buffer = ''
    onLine(line)
  }

  stream.on('data', onData)
  stream.on('end', onEnd)

  return () => {
    stream.off('data', onData)
    stream.off('end', onEnd)
  }
}
