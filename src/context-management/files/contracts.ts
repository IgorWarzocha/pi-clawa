import { type Static, Type } from 'typebox'

export const MaxFileBytes = 1_000_000
const MaxListResults = 100
export const MaxSearchFiles = 100
const MaxMatchesPerFile = 100
export const MaxToolOutputBytes = 64 * 1_024

const path = Type.String({ minLength: 1, maxLength: 1_024 })
const prefix = Type.Union([Type.String({ maxLength: 1_024 }), Type.Null()])
const line = Type.Union([Type.Integer({ maximum: -1 }), Type.Integer({ minimum: 1 }), Type.Null()])

export const ListFilesInput = Type.Object(
  {
    file_order: Type.Optional(Type.Union([Type.Literal('ascending'), Type.Literal('descending')])),
    file_order_by: Type.Optional(
      Type.Union([Type.Literal('name'), Type.Literal('created_at'), Type.Literal('updated_at')]),
    ),
    max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: MaxListResults })),
    prefix: Type.Optional(prefix),
  },
  { additionalProperties: false },
)
export type ListFilesInput = Static<typeof ListFilesInput>

export const ReadFileInput = Type.Object(
  {
    path,
    start_line: Type.Optional(line),
    stop_line: Type.Optional(line),
  },
  { additionalProperties: false },
)
export type ReadFileInput = Static<typeof ReadFileInput>

export const SearchContentsInput = Type.Object(
  {
    max_files: Type.Optional(Type.Integer({ minimum: 1, maximum: MaxSearchFiles })),
    max_matches_per_file: Type.Optional(Type.Integer({ minimum: 1, maximum: MaxMatchesPerFile })),
    path_prefix: Type.Optional(prefix),
    query: Type.String({ minLength: 1, maxLength: 1_024, description: 'Case-sensitive' }),
    recent_file_first: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)
export type SearchContentsInput = Static<typeof SearchContentsInput>

export const ChangeFileInput = Type.Object(
  {
    path,
    text: Type.String({ maxLength: MaxFileBytes }),
    expected_version: Type.Optional(
      Type.Union([Type.String({ pattern: '^[0-9a-f]{64}$' }), Type.Null()], {
        description:
          'Version from read_file; null requires a new file. Omit only for an intentional unconditional replacement.',
      }),
    ),
  },
  { additionalProperties: false },
)
export type ChangeFileInput = Static<typeof ChangeFileInput>

export const ListRevisionsInput = Type.Object(
  {
    path: Type.Optional(path),
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
)
export type ListRevisionsInput = Static<typeof ListRevisionsInput>

export const ReadRevisionInput = Type.Object(
  {
    path,
    revision: Type.String({ pattern: '^[0-9a-f]{40}([0-9a-f]{24})?$' }),
    offset_chars: Type.Optional(Type.Integer({ minimum: 0 })),
    limit_chars: Type.Optional(Type.Integer({ minimum: 1, maximum: 8_000 })),
  },
  { additionalProperties: false },
)
export type ReadRevisionInput = Static<typeof ReadRevisionInput>
