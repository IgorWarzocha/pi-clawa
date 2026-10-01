import { type CollectionEntry, getCollection } from 'astro:content'

export type DocEntry = CollectionEntry<'docs' | 'legacyDocs'>
export const editions = ['modern', 'legacy'] as const
export type Edition = (typeof editions)[number]

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
