import type { APIContext } from 'astro'
import { readChangelog } from '@/lib/changelog'
import { type Edition, editionInfo, editions } from '@/lib/site'

export function getStaticPaths() {
  return editions.map((edition) => ({ params: { edition }, props: { edition } }))
}

export const GET = async ({ props }: APIContext<{ edition: Edition }>): Promise<Response> => {
  const notice = editionInfo[props.edition].changelogNotice
  return new Response(`> ${notice}\n\n${await readChangelog(props.edition)}`, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
}
