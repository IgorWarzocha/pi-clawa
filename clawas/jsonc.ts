export function stripJsoncComments(input: string): string {
  let result = ''
  let inString = false
  let escaped = false
  let inLineComment = false
  let inBlockComment = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!
    const next = input[index + 1]

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false
        result += char
      }
      continue
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        index += 1
        continue
      }
      if (char === '\n') {
        result += char
      }
      continue
    }

    if (inString) {
      result += char
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      result += char
      continue
    }

    if (char === '/' && next === '/') {
      inLineComment = true
      index += 1
      continue
    }

    if (char === '/' && next === '*') {
      inBlockComment = true
      index += 1
      continue
    }

    result += char
  }

  return result
}

export function stripJsonTrailingCommas(input: string): string {
  let result = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!

    if (inString) {
      result += char
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      result += char
      continue
    }

    if (char === ',') {
      let lookahead = index + 1
      while (lookahead < input.length && /\s/.test(input[lookahead]!)) {
        lookahead += 1
      }
      const nextToken = input[lookahead]
      if (nextToken === ']' || nextToken === '}') {
        continue
      }
    }

    result += char
  }

  return result
}

export function parseJsonc(text: string): unknown {
  const withoutComments = stripJsoncComments(text)
  const normalized = stripJsonTrailingCommas(withoutComments)
  return JSON.parse(normalized)
}
