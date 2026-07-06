/**
 * The copilot.v1 SSE contract, shared by the server route (emit) and the
 * inbox Copilot sidebar (consume). Client-safe: names and payload types only.
 * Mirrors sandbox-contract.ts's shape (same delta/activity/final/error
 * vocabulary), scoped to a real conversation and a teammate asker instead of
 * an admin preview.
 *
 * The event vocabulary is a versioned contract, so additions must come as new
 * names (or a v2), never as silent shape changes.
 */
import type { AssistantActivityStatus } from '@/lib/shared/conversation/types'

export const COPILOT_EVENTS = {
  delta: 'copilot.v1.delta',
  activity: 'copilot.v1.activity',
  final: 'copilot.v1.final',
  error: 'copilot.v1.error',
} as const

/** One prior turn in a copilot thread, as sent on the request body: a teammate
 *  question or one of Copilot's own past answers. Shared by the route's request
 *  schema (validated at runtime by the zod literals) and the sidebar's history
 *  building, so the two never drift. */
export interface CopilotHistoryEntry {
  role: 'teammate' | 'copilot'
  content: string
}

/**
 * A structured citation on a copilot answer (mirrors AssistantCitation).
 * `internal` is the visual half of the leak gate: the sidebar renders a
 * citation carrying it with a lock glyph, and `internalSourced` on the final
 * payload is the server-derived signal the "Add to composer" confirm gates
 * on (COPILOT-SIDEBAR-UX.md B.4); the client never re-derives it from the
 * citation list itself.
 */
export interface CopilotCitation {
  type: 'article' | 'post' | 'snippet' | 'summary'
  id: string
  title: string
  url: string
  internal?: boolean
}

/** copilot.v1.delta: one fragment of the streamed answer text. */
export interface CopilotDeltaPayload {
  text: string
}

/** copilot.v1.activity: a live "thinking / searching" status line, reusing
 *  the widget's activity vocabulary. */
export interface CopilotActivityPayload {
  status: AssistantActivityStatus
}

/**
 * copilot.v1.final: the completed turn. `suppressed` carries the silence-rule
 * reason on the rare turn Quinn was muted for (text is then empty and
 * `internalSourced` is always false). `internalSourced` is `true` when any
 * citation in the answer is internal: the server-computed gate the sidebar's
 * leak-gate confirm dialog reads.
 */
export interface CopilotFinalPayload {
  text: string
  citations: CopilotCitation[]
  internalSourced: boolean
  suppressed?: string
}

/** copilot.v1.error: a terminal failure after the stream opened. */
export interface CopilotErrorPayload {
  code: string
  message: string
}

/**
 * transform.v1 SSE contract (P2-C.1): rewrites over already-composed text, run
 * from two entry points (COPILOT-SIDEBAR-UX.md "What P2-C adds"): the answer
 * card's "Add to composer & modify" menu (source = the streamed answer) and
 * the reply composer's Format chip (source = the teammate's own draft). Same
 * delta/final/error vocabulary as copilot.v1, scoped down to a single field
 * (`text`) since a transform has no citations or sources of its own.
 */
export const TRANSFORM_EVENTS = {
  delta: 'transform.v1.delta',
  final: 'transform.v1.final',
  error: 'transform.v1.error',
} as const

/**
 * `my_tone` mines the teammate's own past replies for style excerpts.
 * `more_friendly`/`more_formal`/`more_concise` are shared by both entry
 * points; `expand`/`rephrase`/`fix_grammar` are Format-chip only (there is no
 * "expand the answer" row on the answer card).
 */
export const TRANSFORM_KINDS = [
  'my_tone',
  'more_friendly',
  'more_formal',
  'more_concise',
  'expand',
  'rephrase',
  'fix_grammar',
] as const

export type TransformKind = (typeof TRANSFORM_KINDS)[number]

/** transform.v1.delta: one fragment of the rewritten text. */
export interface TransformDeltaPayload {
  text: string
}

/** transform.v1.final: the completed rewrite. */
export interface TransformFinalPayload {
  text: string
}

/** transform.v1.error: a terminal failure after the stream opened. */
export interface TransformErrorPayload {
  code: string
  message: string
}
