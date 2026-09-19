/**
 * The deterministic customer-publication validator (QUINN-PRODUCT P6).
 *
 * `validateAssistantCompletion` (assistant.runtime.ts) stays what it is: a
 * structural check on the model's output shape, run inside the generation loop.
 * This is the layer after it, and it asks a different question: may this
 * candidate be published to a customer right now, given the evidence it was
 * given, the receipts it produced and the state of the world at this instant.
 *
 * It is pure, and deliberately so. Every input is passed in, including the
 * eligibility recheck's answer, so the whole rule set can be exercised without a
 * database and so the fenced publication can run it under the conversation lock
 * without doing IO inside the decision.
 *
 * What it is not: a correctness oracle. A citation to a real document is not
 * proof the document supports the claim, and nothing here can tell. That is the
 * semantic layer's question (answer-validation.ts). What this layer guarantees
 * is that nothing structurally or permission-wise wrong reaches a customer:
 * no invented citation kind, no citation the turn never retrieved, no internal
 * evidence, no source that was revoked while the turn was generating, no answer
 * claiming an action whose receipt does not say it happened.
 */
import { ASSISTANT_CITATION_TYPES, type AssistantCitationType } from './citation-types'

/** The largest customer-facing reply this validator will publish. */
export const MAX_PUBLISHED_TEXT_CHARS = 8000

/** Response kinds a customer turn may publish. */
export const PUBLISHABLE_RESPONSE_KINDS = ['answer', 'clarification', 'greeting'] as const

export type PublicationValidationCode =
  | 'empty_text'
  | 'output_too_large'
  | 'unsupported_response_kind'
  | 'unknown_citation_kind'
  | 'citation_without_evidence'
  | 'internal_citation'
  | 'internal_evidence'
  | 'revoked_evidence'
  | 'unsettled_action_claim'

export interface PublicationCandidateView {
  text: string
  responseKind: string
  outcome: string
  citations: ReadonlyArray<{ type: string; id: string; internal?: boolean }>
  /** True when the candidate hands the conversation to a person. */
  handoff: boolean
  /** True when the candidate asks to close the conversation as resolved. */
  closeRequest: boolean
}

export interface PublicationEvidenceView {
  sourceType: string
  sourceId: string
  internal: boolean
}

/** One tool receipt this run produced, reduced to what the decision needs. */
export interface PublicationReceiptView {
  toolName: string
  /** Step 5's normalized outcome vocabulary. */
  status: string
}

export interface PublicationValidationInput {
  candidate: PublicationCandidateView
  evidence: readonly PublicationEvidenceView[]
  receipts: readonly PublicationReceiptView[]
  /**
   * Source ids still serveable to this audience, re-read at publication time.
   * `null` means the recheck did not run, which is only legitimate when the
   * candidate cites nothing.
   */
  eligibleSourceIds: ReadonlySet<string> | null
}

export type PublicationVerdict =
  { ok: true } | { ok: false; code: PublicationValidationCode; detail: string }

/** A receipt state that has not settled as a definite success. */
const UNSETTLED_RECEIPT_STATUSES = new Set([
  'unknown',
  'pending_approval',
  'in_progress',
  'started',
  'failed',
  'denied',
])

/**
 * Decide whether a candidate may be published to a customer.
 *
 * The order is cheapest and most decisive first, and each rule names the thing
 * an operator would need to act on rather than a generic refusal.
 */
export function validateCustomerPublication(input: PublicationValidationInput): PublicationVerdict {
  const { candidate } = input

  if (candidate.text.trim().length === 0) {
    return { ok: false, code: 'empty_text', detail: 'the candidate has no text' }
  }
  if (candidate.text.length > MAX_PUBLISHED_TEXT_CHARS) {
    return {
      ok: false,
      code: 'output_too_large',
      detail: `${candidate.text.length} characters exceeds the ${MAX_PUBLISHED_TEXT_CHARS} ceiling`,
    }
  }
  if (!(PUBLISHABLE_RESPONSE_KINDS as readonly string[]).includes(candidate.responseKind)) {
    return {
      ok: false,
      code: 'unsupported_response_kind',
      detail: `response kind "${candidate.responseKind}" is not publishable`,
    }
  }

  const evidenceIds = new Set(input.evidence.map((row) => row.sourceId))
  for (const citation of candidate.citations) {
    if (!(ASSISTANT_CITATION_TYPES as readonly string[]).includes(citation.type)) {
      return {
        ok: false,
        code: 'unknown_citation_kind',
        detail: `"${citation.type}" is not a canonical citation kind`,
      }
    }
    if (citation.internal === true) {
      return {
        ok: false,
        code: 'internal_citation',
        detail: `citation ${citation.id} is internal and cannot be published`,
      }
    }
    // Provenance: a citation the turn never retrieved is an invented one, even
    // when it happens to name a real row. The ledger already drops unknown ids
    // from the assembled list; this is the independent check, so a future path
    // that assembles citations differently cannot bypass it.
    if (!evidenceIds.has(citation.id)) {
      return {
        ok: false,
        code: 'citation_without_evidence',
        detail: `citation ${citation.id} is not in this attempt's evidence`,
      }
    }
    if (input.eligibleSourceIds && !input.eligibleSourceIds.has(citation.id)) {
      return {
        ok: false,
        code: 'revoked_evidence',
        detail: `source ${citation.id} is no longer serveable to this audience`,
      }
    }
  }

  // Internal evidence must not reach a customer even when the model chose not
  // to cite it: the passage was in the prompt, so the answer can repeat it.
  const internalEvidence = input.evidence.find((row) => row.internal)
  if (internalEvidence) {
    return {
      ok: false,
      code: 'internal_evidence',
      detail: `evidence from ${internalEvidence.sourceType} ${internalEvidence.sourceId} is internal`,
    }
  }

  // Receipt state. A turn may honestly tell a customer that something is being
  // reviewed or could not be confirmed, so an unsettled receipt does not block
  // an ordinary reply. What it blocks is the candidate CLAIMING the matter is
  // finished: asking to close the conversation, or reporting an outcome of
  // resolution, while this run's own receipt says the effect never settled.
  const unsettled = input.receipts.find((receipt) => UNSETTLED_RECEIPT_STATUSES.has(receipt.status))
  if (unsettled && (candidate.closeRequest || candidate.outcome === 'resolution')) {
    return {
      ok: false,
      code: 'unsettled_action_claim',
      detail: `${unsettled.toolName} settled as "${unsettled.status}", so this turn cannot close the conversation`,
    }
  }

  return { ok: true }
}

/** Canonical citation kinds, re-exported so a caller validating one has a single source. */
export type { AssistantCitationType }
