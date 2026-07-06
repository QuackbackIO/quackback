/**
 * The assistant-sandbox.v1 SSE contract, shared by the server route (emit) and
 * the admin sandbox page (consume). Client-safe: names and payload types only.
 *
 * The event vocabulary is a versioned contract, so additions must come as new
 * names (or a v2), never as silent shape changes.
 */

export const SANDBOX_EVENTS = {
  delta: 'assistant-sandbox.v1.delta',
  final: 'assistant-sandbox.v1.final',
  error: 'assistant-sandbox.v1.error',
} as const

/** A structured citation on a sandbox answer (mirrors AssistantCitation). */
export interface SandboxCitation {
  type: 'article' | 'post' | 'snippet' | 'summary'
  id: string
  title: string
  url: string
  /** Set when the source is not customer-visible (see AssistantCitation.internal).
   *  Sandbox-only signal for admins previewing the copilot surface; never persisted. */
  internal?: boolean
}

/** An escalation decision on a sandbox answer (mirrors EscalationOutcome). */
export interface SandboxEscalation {
  reason: string
  mode: 'offer' | 'handoff'
}

/** assistant-sandbox.v1.delta: one fragment of the streamed answer text. */
export interface SandboxDeltaPayload {
  text: string
}

/**
 * assistant-sandbox.v1.final: the completed turn. `suppressed` carries the
 * silence-rule reason when Quinn was muted (text is then empty).
 */
export interface SandboxFinalPayload {
  text: string
  citations: SandboxCitation[]
  escalation?: SandboxEscalation | null
  suppressed?: string
}

/** assistant-sandbox.v1.error: a terminal failure after the stream opened. */
export interface SandboxErrorPayload {
  code: string
  message: string
}
