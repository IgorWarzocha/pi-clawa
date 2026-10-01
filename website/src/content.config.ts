import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'zod'

const docsSchema = z.object({
  title: z.string(),
  description: z.string(),
  section: z.enum(['Start', 'Core concepts', 'Operate', 'Reference', 'Project']),
  order: z.number().int(),
})

const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/docs' }),
  schema: docsSchema,
})

const legacyDocs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './.generated/legacy/docs' }),
  schema: docsSchema,
})

export const collections = { docs, legacyDocs }
