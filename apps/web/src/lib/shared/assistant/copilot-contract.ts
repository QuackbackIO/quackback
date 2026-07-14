/**
 * The copilot.v1 SSE contract, shared by the server route (emit) and the
 * inbox Copilot sidebar (consume). Client-safe: names and payload types only.
 * Uses the same delta/activity/final/error vocabulary as Test agent,
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
  // Mirrors ASSISTANT_CITATION_TYPES (citation-types.ts); a client-safe copy so
  // this shared contract never imports the server domain leaf.
  type: 'article' | 'post' | 'snippet' | 'summary' | 'ticket' | 'changelog'
  id: string
  title: string
  url: string
  internal?: boolean
  /** ISO timestamp of the source's last update, when the retrieval layer knows
   *  it — the hovercard's freshness line ("Updated 8 days ago"). Optional and
   *  additive: an absent value simply renders no freshness line. */
  updatedAt?: string
}

/**
 * Which affordance a copilot answer's text is FOR — the intent signal the
 * sidebar reads to decide whether "Add to composer" (a customer-facing reply
 * draft) or "Add as note" (internal analysis/guidance for the teammate) is the
 * primary action. Quinn self-classifies it as a field on its structured output
 * (see `buildCopilotFramingPrompt`); the server defaults it to `draft_reply`
 * whenever the model omits it, so an un-classified answer keeps the historical
 * "Add to composer primary" behaviour and this can only ever improve, never
 * regress, the affordance. Making the mode machine-readable per answer is what
 * lets the button precedence follow it automatically.
 */
export type CopilotAnswerType = 'draft_reply' | 'analysis'

/**
 * The copilot usage-event vocabulary (the outcome half of the Copilot usage
 * report — see analytics/copilot-usage.ts): which panel gesture an
 * `assistant_events` row records. Shared by the server fn's zod schema
 * (`z.enum(COPILOT_EVENT_TYPES)`, lib/server/functions/copilot-events.ts) and
 * the panel's fire-and-forget client seam, so the two can never drift.
 *
 * An event type names WHAT was inserted (an answer, a transform result, a
 * summary, a proactive suggestion); WHERE it landed is the separate
 * destination axis (`COPILOT_INSERT_DESTINATIONS`, required on every
 * `*_inserted` event and carried in metadata), so the same answer inserted as
 * a reply draft vs an internal note is one kind with two destinations, not
 * two kinds. `feedback` is the only type that carries a rating.
 *
 * The `suggestion_*` triple is the proactive-suggestion funnel: `shown` when
 * a generated suggestion card renders (the acceptance-rate denominator),
 * `inserted` when its text lands in the composer/note (destination required,
 * like every `*_inserted`), `dismissed` when the teammate explicitly waves it
 * off. Shown/dismissed carry no destination and no rating.
 */
export const COPILOT_EVENT_TYPES = [
  'answer_inserted',
  'transform_inserted',
  'summary_inserted',
  'suggestion_shown',
  'suggestion_inserted',
  'suggestion_dismissed',
  'feedback',
] as const

export type CopilotEventType = (typeof COPILOT_EVENT_TYPES)[number]

/**
 * Where an inserted event's text landed: the customer-facing reply composer
 * or an internal note. Orthogonal to the event type by design — see
 * `COPILOT_EVENT_TYPES`'s doc.
 */
export const COPILOT_INSERT_DESTINATIONS = ['reply', 'note'] as const

export type CopilotInsertDestination = (typeof COPILOT_INSERT_DESTINATIONS)[number]

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
 * A write-tool call this copilot turn turned into a pending-approval row
 * (P2-C.4, "act-on-approval"): a Copilot answer can propose a real action and a
 * teammate approves it inline, without Quinn ever running it directly from the
 * Q&A turn. Mirrors `CopilotCitation`'s role for citations: the client-safe
 * shape of `AssistantProposedAction`.
 */
export interface CopilotProposedAction {
  /** The `assistant_pending_actions` row id, what the approve/reject fns key on. */
  id: string
  toolName: string
  /** Human-readable one-liner, same text the inbox approval note card shows. */
  summary: string
  /** The admin-facing tool name (e.g. "End conversation"), for the card's title. */
  label: string
}

/**
 * copilot.v1.final: the completed turn. `suppressed` carries the silence-rule
 * reason on the rare turn Quinn was muted for (text is then empty and
 * `internalSourced` is always false). `internalSourced` is `true` when any
 * citation in the answer is internal: the server-computed gate the sidebar's
 * leak-gate confirm dialog reads. `proposedActions` is empty outside a turn
 * that called a write tool (every write tool proposes rather than executes on
 * this surface; see the copilot route's doc comment).
 */
export interface CopilotFinalPayload {
  text: string
  citations: CopilotCitation[]
  internalSourced: boolean
  suppressed?: string
  proposedActions: CopilotProposedAction[]
  /** Whether `text` is a customer-facing reply draft or internal analysis; see
   *  `CopilotAnswerType`. Always `draft_reply` on a suppressed turn (no text,
   *  no action buttons), and defaulted to `draft_reply` whenever Quinn omits it. */
  answerType: CopilotAnswerType
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
 * the composer's Improve menu (source = the teammate's active draft). Same
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
 * points; `expand`/`rephrase`/`fix_grammar` are Improve-menu only (there is no
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

/**
 * suggest.v1 SSE contract: a proactive reply suggestion for the conversation's
 * latest unanswered customer message, generated when a teammate views the
 * conversation (pull-on-view, not push-per-message — the server never
 * speculates on conversations nobody is looking at). Same delta/final/error
 * vocabulary as copilot.v1; no activity events (the card shows a single
 * loading state) and no proposed actions (a suggestion turn runs its tools
 * read-only — it drafts, it never acts).
 *
 * The server currently sends FINAL-ONLY: no delta frames. A suggestion turn's
 * honest-miss (`skip: true`) is only knowable at the end of the run, so
 * streaming the text as it generates would show the teammate a draft that a
 * trailing skip then evaporates — a guess dressed up as a draft, on screen
 * the whole time. `delta` stays in the vocabulary (clients must keep
 * handling it) so streaming can return once a skip-aware transport exists.
 */
export const SUGGEST_EVENTS = {
  delta: 'suggest.v1.delta',
  final: 'suggest.v1.final',
  error: 'suggest.v1.error',
} as const

/** suggest.v1.delta: one fragment of the streamed suggestion text. */
export interface SuggestDeltaPayload {
  text: string
}

/**
 * suggest.v1.final: the completed suggestion. `skip: true` is the honest-miss
 * outcome — Quinn judged there is nothing grounded worth suggesting (text is
 * then empty, `internalSourced` false, and the client renders no card rather
 * than an empty one). `internalSourced` gates the same blocking confirm the
 * Copilot panel uses before internal-derived text reaches the customer
 * composer.
 */
export interface SuggestFinalPayload {
  text: string
  citations: CopilotCitation[]
  internalSourced: boolean
  skip?: boolean
}

/** suggest.v1.error: a terminal failure after the stream opened. */
export interface SuggestErrorPayload {
  code: string
  message: string
}
