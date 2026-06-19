const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'] as const

export function getSpinnerFrame(now: number): string {
  const index = Math.floor(now / 160) % SPINNER_FRAMES.length
  return SPINNER_FRAMES[index]!
}
