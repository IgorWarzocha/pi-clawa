import type { APIContext } from 'astro'
import { type DocEntry, docHref, type Edition, editions, getDocs } from '@/lib/site'

type Props = { doc: DocEntry; edition: Edition }

export async function getStaticPaths() {
  const pages = await Promise.all(
    editions.map(async (edition) =>
      (await getDocs(edition)).map((doc) => ({
        params: { edition, slug: doc.id },
        props: { doc, edition },
      })),
    ),
  )
  return pages.flat()
}

export const GET = ({ props, site }: APIContext<Props>): Response => {
  const { doc, edition } = props
  if (doc.body === undefined) throw new Error(`Missing Markdown body: ${edition}/${doc.id}`)
  const notice =
    edition === 'modern'
      ? 'Modern is active development, not a tagged release. v0.3.0 belongs to legacy.'
      : 'Legacy preserves the 0.3.0 documentation. References to master describe the old branch layout.'
  const page = new URL(docHref(doc, edition), site)
  return new Response(`# ${doc.data.title}\n\n> ${notice}\n\nWeb page: ${page}\n\n${doc.body}\n`, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
}
