/**
 * The Copilot surface contract, shared by the server routes (emit) and the
 * inbox Copilot sidebar (consume). Client-safe: payload types and the usage
 * vocabulary only. The wire itself is TanStack AI's AG-UI protocol: text
 * streams as structured-JSON deltas, activity rides STEP_STARTED, and each
 * surface's final payload below travels on the terminal RUN_FINISHED's
 * standard `result` slot — so this module carries payload SHAPES, not event
 * names. The payload shapes are a versioned contract: additions must come as
 * new fields, never as silent shape changes.
 */

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
 * draft) is the primary action or the answer is read-only text (internal
 * analysis/guidance for the teammate). Quinn self-classifies it as a field on
 * its structured output (see `buildCopilotFramingPrompt`); the server
 * defaults it to `draft_reply` whenever the model omits it, so an
 * un-classified answer keeps the historical "Add to composer primary"
 * behaviour and this can only ever improve, never regress, the affordance.
 * Making the mode machine-readable per answer is what lets the button
 * precedence follow it automatically.
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
 * summary); WHERE it landed is the separate destination axis
 * (`COPILOT_INSERT_DESTINATIONS`, required on every `*_inserted` event and
 * carried in metadata), so the same answer inserted as a reply draft vs an
 * internal note is one kind with two destinations, not two kinds. `feedback`
 * is the only type that carries a rating.
 */
export const COPILOT_EVENT_TYPES = [
  'answer_inserted',
  'transform_inserted',
  'summary_inserted',
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
 * The completed turn (RUN_FINISHED.result). `suppressed` carries the silence-rule
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

/**
 * Transform (P2-C.1): rewrites over already-composed text, run from two entry
 * points (COPILOT-SIDEBAR-UX.md "What P2-C adds"): the answer card's "Add to
 * composer & modify" menu (source = the streamed answer) and the composer's
 * Improve menu (source = the teammate's active draft). Scoped down to a
 * single field (`text`) since a transform has no citations or sources of its
 * own.
 */

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

/** The completed rewrite (RUN_FINISHED.result). */
export interface TransformFinalPayload {
  text: string
}
