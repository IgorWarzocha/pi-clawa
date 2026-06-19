export type Intent =
  | { type: 'screen'; screen: string }
  | { type: 'detail'; key: string }
  | { type: 'action'; name: string }
  | { type: 'link'; url: string }

type Tier = 'top' | 'nested'
export type Tone = 'normal' | 'dim' | 'accent'
export type Cell = { text: string; tone: Tone }
export type Line = { cells: Cell[] }
export type Slot = {
  title: string
  content: Line[]
  shortcuts: string
  active: number[]
  tier: Tier
  tab: boolean
}

export type Theme = { fg: (color: string, text: string) => string }
type View = {
  render: (width: number) => string[]
  invalidate: () => void
  handleInput: (data: string) => void
}
type Ui = {
  custom: <T>(
    factory: (
      tui: { requestRender: () => void },
      theme: Theme,
      keys: unknown,
      done: (result: T) => void,
    ) => View,
  ) => Promise<T>
}
export type Ctx = { hasUI: boolean; ui: Ui }

export type Primitive = {
  slot: () => Slot
  up: () => void
  down: () => void
  search: () => boolean
  set: (query: string) => void
  enter: () => Intent | undefined
  hasView: () => boolean
  view: () => Intent | undefined
}

export type RunAppConfig<Screen extends string> = {
  registry: Record<Screen, Primitive>
  details: Record<string, Primitive>
  cycle: Screen[]
  initial: Screen
  about: Screen
  help: Screen
}

export type Align = 'left' | 'right'
export type Col<T> = {
  show: boolean
  width: number
  tone: Tone
  align: Align
  pick: (item: T) => string
}
type ListFlow = { columns: number }
export type ListOptions<T> = {
  title: string
  items: T[]
  shortcuts: string
  tier: Tier
  tab: boolean
  search: boolean
  prompt: boolean
  page: number
  find: (item: T, query: string) => boolean
  intent: (item: T) => Intent | undefined
  view?: (item: T) => Intent | undefined
  cols: Col<T>[]
  flow?: ListFlow
}
export type ActionOptions<T> = {
  title: string
  items: T[]
  shortcuts: string
  page: number
  find: (item: T, query: string) => boolean
  intent: (item: T) => Intent | undefined
  view?: (item: T) => Intent | undefined
  cols: Col<T>[]
  flow?: ListFlow
}

export type PickerItem<T> = { label: string; value: T; searchableText?: string }
export type PickerOptions<T> = {
  title: string
  items: PickerItem<T>[]
  search?: boolean
  page?: number
  shortcuts?: string
  match?: (item: PickerItem<T>, query: string) => boolean
}
export type ComposerOptions = {
  title: string
  initial?: string
  placeholder?: string
  shortcuts?: string
  maxLines?: number
  maxLength?: number
}

export const FRAME_ROWS = 15
export const DETAIL_PAGE = 24
export const PICKER_PAGE = 7
export const COMPOSER_VISIBLE_ROWS = 6
