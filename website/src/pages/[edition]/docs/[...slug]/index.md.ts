import type { APIContext } from 'astro'
import { type DocEntry, docHref, type Edition, editionInfo, editions, getDocs } from '@/lib/site'

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
  const notice = editionInfo[edition].docsNotice
  const page = new URL(docHref(doc, edition), site)
  return new Response(`# ${doc.data.title}\n\n> ${notice}\n\nWeb page: ${page}\n\n${doc.body}\n`, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
}
