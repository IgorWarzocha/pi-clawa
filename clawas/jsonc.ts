const WHITESPACE_REGEX = /\s/

type CommentState = {
  result: string
  inString: boolean
  escaped: boolean
  inLineComment: boolean
  inBlockComment: boolean
}

type StringState = {
  result: string
  inString: boolean
  escaped: boolean
}

export function stripJsoncComments(input: string): string {
  const state: CommentState = {
    result: '',
    inString: false,
    escaped: false,
    inLineComment: false,
    inBlockComment: false,
  }

  for (let index = 0; index < input.length; index += 1) {
    index = consumeJsoncCommentChar(input, index, state)
  }

  return state.result
}

function consumeJsoncCommentChar(input: string, index: number, state: CommentState): number {
  const char = input.charAt(index)
  const next = input.charAt(index + 1)
  if (consumeLineComment(char, state)) return index
  if (consumeBlockComment(char, next, state))
    return next === '/' && char === '*' ? index + 1 : index
  if (consumeJsonString(char, state)) return index
  if (startJsonString(char, state)) return index
  if (char === '/' && next === '/') {
    state.inLineComment = true
    return index + 1
  }
  if (char === '/' && next === '*') {
    state.inBlockComment = true
    return index + 1
  }
  state.result += char
  return index
}

function consumeLineComment(char: string, state: CommentState): boolean {
  if (!state.inLineComment) return false
  if (char === '\n') {
    state.inLineComment = false
    state.result += char
  }
  return true
}

function consumeBlockComment(char: string, next: string, state: CommentState): boolean {
  if (!state.inBlockComment) return false
  if (char === '*' && next === '/') {
    state.inBlockComment = false
    return true
  }
  if (char === '\n') state.result += char
  return true
}

function consumeJsonString(char: string, state: StringState): boolean {
  if (!state.inString) return false
  state.result += char
  if (state.escaped) {
    state.escaped = false
    return true
  }
  if (char === '\\') {
    state.escaped = true
    return true
  }
  if (char === '"') state.inString = false
  return true
}

function startJsonString(char: string, state: StringState): boolean {
  if (char !== '"') return false
  state.inString = true
  state.result += char
  return true
}

export function stripJsonTrailingCommas(input: string): string {
  const state: StringState = { result: '', inString: false, escaped: false }

  for (let index = 0; index < input.length; index += 1) {
    const char = input.charAt(index)
    if (consumeJsonString(char, state) || startJsonString(char, state)) continue
    if (char === ',' && nextTokenClosesContainer(input, index + 1)) continue
    state.result += char
  }

  return state.result
}

function nextTokenClosesContainer(input: string, start: number): boolean {
  let lookahead = start
  while (lookahead < input.length && WHITESPACE_REGEX.test(input.charAt(lookahead))) {
    lookahead += 1
  }
  const nextToken = input.charAt(lookahead)
  return nextToken === ']' || nextToken === '}'
}

export function parseJsonc(text: string): unknown {
  const withoutComments = stripJsoncComments(text)
  const normalized = stripJsonTrailingCommas(withoutComments)
  return JSON.parse(normalized)
}
