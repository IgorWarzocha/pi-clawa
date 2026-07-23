import { type CollectionEntry, getCollection } from 'astro:content'

export type DocEntry = CollectionEntry<'docs'>

const sectionOrder = ['Start', 'Core concepts', 'Operate', 'Reference', 'Project'] as const
const TRAILING_SLASH = /\/$/u

export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(TRAILING_SLASH, '')
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalized}`
}

export function docHref(doc: DocEntry): string {
  return withBase(`/docs/${doc.id}/`)
}

export async function getDocs(): Promise<DocEntry[]> {
  const docs = await getCollection('docs')
  return docs.sort((left, right) => left.data.order - right.data.order)
}

export function groupDocs(docs: DocEntry[]): Map<string, DocEntry[]> {
  return new Map(
    sectionOrder.map((section) => [section, docs.filter((doc) => doc.data.section === section)]),
  )
}
