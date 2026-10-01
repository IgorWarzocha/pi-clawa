import { type CollectionEntry, getCollection } from 'astro:content'

export type DocEntry = CollectionEntry<'docs' | 'legacyDocs'>
export const editions = ['modern', 'legacy'] as const
export type Edition = (typeof editions)[number]

export const editionInfo = {
  modern: {
    name: 'Modern',
    version: '0.4.0',
    docsNotice:
      'Modern 0.4.0 is the stable default. Install v0.4.0 for the release or follow modern for development. Requires Pi 0.99.2 or newer.',
    changelogNotice:
      'Modern 0.4.0 was released on 2026-10-01. Unreleased tracks subsequent development. Historical 0.3.0 entries belong to legacy.',
  },
  legacy: {
    name: 'Legacy',
    version: '0.3.1',
    docsNotice:
      'Legacy 0.3.1 is supported and retains RPC workers and SQLite memory. Requires Pi 0.99.2 or newer. These docs follow legacy maintenance, not the unchanged v0.3.0 tag. References to master describe the former branch name.',
    changelogNotice:
      'Legacy 0.3.1 was released on 2026-10-01. Unreleased tracks subsequent maintenance. The historical v0.3.0 tag stays unchanged.',
  },
} as const

const sectionOrder = ['Start', 'Core concepts', 'Operate', 'Reference', 'Project'] as const
const TRAILING_SLASH = /\/$/u

export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(TRAILING_SLASH, '')
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalized}`
}

export function docHref(doc: DocEntry, edition: Edition): string {
  return withBase(`/${edition}/docs/${doc.id}/`)
}

export async function getDocs(edition: Edition = 'modern'): Promise<DocEntry[]> {
  const docs = await getCollection(edition === 'modern' ? 'docs' : 'legacyDocs')
  return docs.sort((left, right) => left.data.order - right.data.order)
}

export function groupDocs(docs: DocEntry[]): Map<string, DocEntry[]> {
  return new Map(
    sectionOrder
      .map((section): [string, DocEntry[]] => [
        section,
        docs.filter((doc) => doc.data.section === section),
      ])
      .filter(([, entries]) => entries.length > 0),
  )
}
