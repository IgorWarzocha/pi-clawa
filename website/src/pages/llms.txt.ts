import type { APIContext } from 'astro'
import { docHref, editionInfo, editions, getDocs, withBase } from '@/lib/site'

export const GET = async ({ site }: APIContext): Promise<Response> => {
  const url = (path: string): string => new URL(path, site).href
  const sections = await Promise.all(
    editions.map(async (edition) => {
      const docs = await getDocs(edition)
      const title = `${editionInfo[edition].name} ${editionInfo[edition].version}`
      const links = docs.map(
        (doc) =>
          `- [${doc.data.title}](${url(`${docHref(doc, edition)}index.md`)}): ${doc.data.description}`,
      )
      links.push(`- [Changelog](${url(withBase(`/${edition}/changelog.md`))})`)
      return `## ${title}\n\n${links.join('\n')}`
    }),
  )
  const upgrade = url(withBase('/modern/docs/operate/upgrading/index.md'))
  const comparison = url(withBase('/versions/'))
  return new Response(
    `${[
      '# Clawa for Pi',
      '> A Pi extension with a living home, shared memory, resident specialists, and Pulses.',
      'Modern v0.4.0 is the stable default. Legacy v0.3.1 remains supported with its RPC and SQLite architecture. Both were released on 2026-10-01 and require Pi 0.99.2 or newer. Install a release tag by default. The modern branch is optional development, and legacy follows maintenance. The historical v0.3.0 tag stays unchanged. Keep instructions matched to the installed edition and commit.',
      `For an existing home, start with [Upgrading and removing](${upgrade}). It covers checkout discovery, the same-session restart handoff, migration checks, and rollback limits.`,
      `[Compare modern and legacy](${comparison}). Guides below are plain Markdown generated from the same source as the website, not separate instructions.`,
      ...sections,
    ].join('\n\n')}\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  )
}
