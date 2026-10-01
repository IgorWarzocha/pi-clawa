import type {
  ContextAgentIdentity,
  SharedContextRequest,
  SharedContextResult,
} from '@howaboua/pi-codex-conversion/context-sharing'
import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

const threadId = Type.String({ pattern: '^[a-zA-Z0-9_-]+$' })
const agentName = Type.String({ pattern: '^/root(?:/[a-zA-Z0-9_-]+)*$' })
const request = Type.Object({
  sessionId: threadId,
  agentName,
  namespace: Type.Union([Type.Literal('notes'), Type.Literal('history')]),
  params: Type.Record(Type.String(), Type.Unknown()),
})

const command = Type.Union([
  Type.Object(
    {
      type: Type.Literal('context'),
      operation: Type.Literal('bind'),
      sessionId: threadId,
      binding: Type.Unknown(),
      id: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('context'),
      operation: Type.Literal('execute'),
      request,
      visited: Type.Array(threadId, { maxItems: 63 }),
      id: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
])

export type ClawasContextCommand = Static<typeof command>
export type SharedResidentContext = Pick<ContextAgentIdentity, 'sessionId' | 'agentName'>

export function parseContextCommand(input: unknown): ClawasContextCommand {
  return Value.Parse(command, input)
}

export function parseContextRequest(input: unknown): SharedContextRequest {
  return Value.Parse(request, input)
}

const identity = Type.Object({
  protocol: Type.Literal(1),
  sessionId: threadId,
  threadId,
  agentName,
  storage: Type.Union([Type.Literal('session'), Type.Literal('remote')]),
  accountScope: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })),
  routing: Type.Optional(Type.Unknown()),
})

export function parseContextIdentity(input: unknown): ContextAgentIdentity {
  return Value.Parse(identity, input)
}

export function parseSharedResidentContext(input: unknown): SharedResidentContext {
  return Value.Parse(Type.Pick(identity, ['sessionId', 'agentName']), input)
}

const result = Type.Object({
  content: Type.Array(
    Type.Union([
      Type.Object({ type: Type.Literal('text'), text: Type.String() }),
      Type.Object({
        type: Type.Literal('image'),
        data: Type.String(),
        mimeType: Type.String(),
      }),
    ]),
  ),
  details: Type.Object({ codexHistoryNotes: Type.Record(Type.String(), Type.Unknown()) }),
})

export function parseContextResult(input: unknown): SharedContextResult {
  return Value.Parse(result, input)
}

const member = Type.Object({
  parentThreadId: threadId,
  childThreadId: threadId,
  sessionId: threadId,
  agentName,
})

export type ContextMember = Static<typeof member>

export function parseContextMember(input: unknown): ContextMember {
  return Value.Parse(member, input)
}

const parentRoute = Type.Object({
  transport: Type.Literal('clawa'),
  parentThreadId: threadId,
})

export function parseParentContextRoute(input: unknown): Static<typeof parentRoute> {
  return Value.Parse(parentRoute, input)
}
