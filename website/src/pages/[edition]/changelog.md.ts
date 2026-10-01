import type { APIContext } from 'astro'
import { readChangelog } from '@/lib/changelog'
import { type Edition, editions } from '@/lib/site'

export function getStaticPaths() {
  return editions.map((edition) => ({ params: { edition }, props: { edition } }))
}

export const GET = async ({ props }: APIContext<{ edition: Edition }>): Promise<Response> => {
  const notice =
    props.edition === 'modern'
      ? 'Modern changes are unreleased. The 0.3.0 release belongs to legacy.'
      : 'This is the release history preserved with the legacy branch.'
  return new Response(`> ${notice}\n\n${await readChangelog(props.edition)}`, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
}
