import type { APIContext } from 'astro'
import { docHref, editions, getDocs, withBase } from '@/lib/site'

export const GET = async ({ site }: APIContext): Promise<Response> => {
  const url = (path: string): string => new URL(path, site).href
  const sections = await Promise.all(
    editions.map(async (edition) => {
      const docs = await getDocs(edition)
      const title =
        edition === 'modern'
          ? 'Modern: unreleased development'
          : 'Legacy: supported architecture descended from 0.3.0'
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
      'Modern is unreleased development. Legacy receives compatibility maintenance without adopting modern architecture. Both branches target Pi 0.99.2; the minimum is 0.87.1. The unchanged v0.3.0 tag belongs to legacy and excludes later maintenance. Keep instructions matched to the installed branch.',
      `For an existing home, start with [Upgrading and removing](${upgrade}). It covers checkout discovery, the same-session restart handoff, migration checks, and rollback limits.`,
      `[Compare modern and legacy](${comparison}). Guides below are plain Markdown generated from the same source as the website, not separate instructions.`,
      ...sections,
    ].join('\n\n')}\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  )
}
