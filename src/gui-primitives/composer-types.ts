export type ComposerState = {
  lines: string[]
  line: number
  col: number
  top: number
  width: number
  length: number
  dirty: boolean
}

export type ComposerOps = {
  br: () => void
  bs: () => void
  del: () => void
  write: (value: string) => void
}

export type WrappedRow = { line: number; text: string }
