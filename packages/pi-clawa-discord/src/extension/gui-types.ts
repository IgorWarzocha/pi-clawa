export type DiscordGuiAction = 'guide' | 'token' | 'restart' | 'stop' | 'close'
export type DiscordGuiMode = 'menu' | 'token'
export type DiscordGuiItem = {
  action: DiscordGuiAction
  label: string
  detail: string
}
export type DiscordGuiSnapshot = {
  projectRoot: string
  configPath: string
  tokenSet: boolean
  maskedToken: string
  routesPath: string
  gatewayRunning: boolean
}
export type CustomView = {
  render: (width: number) => string[]
  invalidate: () => void
  handleInput: (data: string) => void
}
