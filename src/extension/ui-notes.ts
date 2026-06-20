import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { TemplateCopyResult } from '../template-files.js'
import type { ExtensionConfigStatus } from './runtime-state.js'

export function formatMessageContent(
  content: string | Array<{ type: string; text?: string }>,
): string {
  if (typeof content === 'string') return content
  return content
    .map((part) => (part.type === 'text' ? (part.text ?? '') : '[non-text content]'))
    .join('\n')
    .trim()
}

export function sendDimNote(pi: ExtensionAPI, text: string): void {
  pi.sendMessage({ customType: 'claw-dim', content: text, display: true })
}

export function notifyInitialBootstrap(
  ctx: ExtensionContext,
  extensionConfig: ExtensionConfigStatus,
  copied: TemplateCopyResult,
  markedPath: string,
): void {
  if (!ctx.hasUI) return
  ctx.ui.setStatus('clawa', 'clawa: bootstrapping')
  if (extensionConfig.created) {
    ctx.ui.notify(`Clawa config created at ${extensionConfig.path}`, 'info')
  }
  ctx.ui.notify(
    `Clawa initialized ${copied.copied.length} main files and marked ${markedPath} bootstrapped`,
    'info',
  )
}

function buildBootstrapBlockedMessage(files: string[]): string {
  const listed = files.map((file) => `- ${file}`).join('\n')
  return [
    'Clawa cannot initialize in this folder because it already contains Clawa core markdown files:',
    listed,
    '',
    'This extension is supposed to be initialized without those files present.',
    'Please move them out of the folder, start Clawa again, then ask your claw to manually edit the generated files to suit.',
    'Clawa core markdown files are slightly different from what you might be used to.',
  ].join('\n')
}

export function reportBootstrapBlocked(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  files: string[],
): void {
  const message = buildBootstrapBlockedMessage(files)
  sendDimNote(pi, message)
  if (ctx.hasUI) {
    ctx.ui.setStatus('clawa', 'clawa: bootstrap blocked')
    ctx.ui.notify(`Clawa bootstrap blocked by existing files: ${files.join(', ')}`, 'warning')
  }
}
