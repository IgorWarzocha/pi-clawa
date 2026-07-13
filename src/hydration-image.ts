import { readdir, readFile } from 'node:fs/promises'
import { extname, join, parse } from 'node:path'
import type { ImageContent } from '@earendil-works/pi-ai'
import { resizeImage } from '@earendil-works/pi-coding-agent'

const IMAGE_FORMATS = [
  { extension: '.png', mimeType: 'image/png' },
  { extension: '.jpg', mimeType: 'image/jpeg' },
  { extension: '.jpeg', mimeType: 'image/jpeg' },
  { extension: '.webp', mimeType: 'image/webp' },
  { extension: '.gif', mimeType: 'image/gif' },
] as const
const IMAGE_MAX_DIMENSION = 1_024
const IMAGE_MAX_BYTES = 1_500_000
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export interface HydratedClawaImage {
  content: ImageContent
  path: string
}

export interface ClawaImageLoadResult {
  image?: HydratedClawaImage | undefined
  warning?: string | undefined
}

type CandidateLoadResult =
  | { image: HydratedClawaImage; failure?: never }
  | { failure: string; image?: never }

function imageFormat(filename: string): (typeof IMAGE_FORMATS)[number] | undefined {
  const parsed = parse(filename)
  if (parsed.name.toUpperCase() !== 'CLAWA') return undefined
  const extension = extname(filename).toLowerCase()
  return IMAGE_FORMATS.find((format) => format.extension === extension)
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

function startsWithAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  return Array.from(text).every(
    (character, index) => bytes[offset + index] === character.charCodeAt(0),
  )
}

function detectImageMimeType(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png'
  if (startsWithAscii(bytes, 0, 'GIF')) return 'image/gif'
  if (startsWithAscii(bytes, 0, 'RIFF') && startsWithAscii(bytes, 8, 'WEBP')) return 'image/webp'
  return undefined
}

async function findCandidates(cwd: string): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(cwd)
  } catch {
    return []
  }

  return names
    .filter((name) => imageFormat(name))
    .sort((left, right) => {
      const leftPriority = IMAGE_FORMATS.findIndex(
        (format) => format.extension === extname(left).toLowerCase(),
      )
      const rightPriority = IMAGE_FORMATS.findIndex(
        (format) => format.extension === extname(right).toLowerCase(),
      )
      return leftPriority - rightPriority || left.localeCompare(right)
    })
}

async function loadCandidate(cwd: string, filename: string): Promise<CandidateLoadResult> {
  const format = imageFormat(filename)
  if (!format) return { failure: `${filename} has an unsupported format` }
  const path = join(cwd, filename)

  try {
    const bytes = await readFile(path)
    if (bytes.length === 0) return { failure: `${filename} is empty` }
    const mimeType = detectImageMimeType(bytes)
    if (!mimeType) return { failure: `${filename} is not a supported image` }
    const resized = await resizeImage(bytes, mimeType, {
      maxWidth: IMAGE_MAX_DIMENSION,
      maxHeight: IMAGE_MAX_DIMENSION,
      maxBytes: IMAGE_MAX_BYTES,
    })
    if (!resized) return { failure: `${filename} could not be decoded or resized` }
    return {
      image: {
        path,
        content: { type: 'image', data: resized.data, mimeType: resized.mimeType },
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { failure: `${filename}: ${message}` }
  }
}

export async function loadClawaImage(cwd: string): Promise<ClawaImageLoadResult> {
  const candidates = await findCandidates(cwd)
  const failures: string[] = []

  for (const filename of candidates) {
    const loaded = await loadCandidate(cwd, filename)
    if (loaded.image) {
      const extra = candidates.length > 1 ? ` Multiple CLAWA images found; using ${filename}.` : ''
      return {
        image: loaded.image,
        ...(extra ? { warning: extra.trim() } : {}),
      }
    }
    failures.push(loaded.failure)
  }

  if (failures.length === 0) return {}
  return { warning: `CLAWA image skipped: ${failures.join('; ')}` }
}
