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
