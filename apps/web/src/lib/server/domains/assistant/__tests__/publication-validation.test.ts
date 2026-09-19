/**
 * The deterministic customer-publication validator.
 *
 * Every case pairs a refusal with the publishable candidate it differs from by
 * one field, so a rule that stopped working fails here rather than quietly
 * admitting everything.
 */
import { describe, it, expect } from 'vitest'
import {
  MAX_PUBLISHED_TEXT_CHARS,
  validateCustomerPublication,
  type PublicationValidationInput,
} from '../publication-validation'

function input(overrides: Partial<PublicationValidationInput> = {}): PublicationValidationInput {
  return {
    candidate: {
      text: 'Refunds land within ten days. [1]',
      responseKind: 'answer',
      outcome: 'answer',
      citations: [{ type: 'article', id: 'article_1' }],
      handoff: false,
      closeRequest: false,
      ...overrides.candidate,
    },
    evidence: overrides.evidence ?? [
      { sourceType: 'article', sourceId: 'article_1', internal: false },
    ],
    receipts: overrides.receipts ?? [],
    eligibleSourceIds: overrides.eligibleSourceIds ?? new Set(['article_1']),
  }
}

describe('validateCustomerPublication', () => {
  it('publishes a grounded answer whose citation is still serveable', () => {
    expect(validateCustomerPublication(input())).toEqual({ ok: true })
  })

  it('publishes a greeting with no citations at all', () => {
    expect(
      validateCustomerPublication(
        input({
          candidate: {
            text: 'Hello, how can I help?',
            responseKind: 'greeting',
            outcome: 'greeting',
            citations: [],
            handoff: false,
            closeRequest: false,
          },
          evidence: [],
          eligibleSourceIds: null,
        })
      )
    ).toEqual({ ok: true })
  })

  it('refuses empty text', () => {
    const verdict = validateCustomerPublication(
      input({
        candidate: {
          text: '   ',
          responseKind: 'answer',
          outcome: 'answer',
          citations: [],
          handoff: false,
          closeRequest: false,
        },
        evidence: [],
        eligibleSourceIds: null,
      })
    )
    expect(verdict).toMatchObject({ ok: false, code: 'empty_text' })
  })

  it('refuses an answer past the size ceiling', () => {
    const verdict = validateCustomerPublication(
      input({
        candidate: {
          text: 'x'.repeat(MAX_PUBLISHED_TEXT_CHARS + 1),
          responseKind: 'answer',
          outcome: 'answer',
          citations: [],
          handoff: false,
          closeRequest: false,
        },
        evidence: [],
        eligibleSourceIds: null,
      })
    )
    expect(verdict).toMatchObject({ ok: false, code: 'output_too_large' })
  })

  it('refuses a response kind outside the publishable vocabulary', () => {
    const verdict = validateCustomerPublication(
      input({
        candidate: {
          text: 'Here you go.',
          responseKind: 'internal_note',
          outcome: 'answer',
          citations: [],
          handoff: false,
          closeRequest: false,
        },
        evidence: [],
        eligibleSourceIds: null,
      })
    )
    expect(verdict).toMatchObject({ ok: false, code: 'unsupported_response_kind' })
  })

  it('refuses a citation kind outside the canonical vocabulary', () => {
    const verdict = validateCustomerPublication(
      input({
        candidate: {
          text: 'See the runbook. [1]',
          responseKind: 'answer',
          outcome: 'answer',
          citations: [{ type: 'runbook', id: 'article_1' }],
          handoff: false,
          closeRequest: false,
        },
      })
    )
    expect(verdict).toMatchObject({ ok: false, code: 'unknown_citation_kind' })
  })

  it('refuses a citation the turn never retrieved', () => {
    const verdict = validateCustomerPublication(
      input({
        candidate: {
          text: 'See the policy. [1]',
          responseKind: 'answer',
          outcome: 'answer',
          citations: [{ type: 'article', id: 'article_invented' }],
          handoff: false,
          closeRequest: false,
        },
        eligibleSourceIds: new Set(['article_invented']),
      })
    )
    expect(verdict).toMatchObject({ ok: false, code: 'citation_without_evidence' })
  })

  it('refuses a citation flagged internal', () => {
    const verdict = validateCustomerPublication(
      input({
        candidate: {
          text: 'Per the internal note. [1]',
          responseKind: 'answer',
          outcome: 'answer',
          citations: [{ type: 'document', id: 'assistant_document_1', internal: true }],
          handoff: false,
          closeRequest: false,
        },
        evidence: [{ sourceType: 'document', sourceId: 'assistant_document_1', internal: true }],
        eligibleSourceIds: new Set(['assistant_document_1']),
      })
    )
    expect(verdict).toMatchObject({ ok: false, code: 'internal_citation' })
  })

  it('refuses internal evidence even when the answer cited nothing', () => {
    const verdict = validateCustomerPublication(
      input({
        candidate: {
          text: 'The rota says Tuesdays.',
          responseKind: 'answer',
          outcome: 'answer',
          citations: [],
          handoff: false,
          closeRequest: false,
        },
        evidence: [{ sourceType: 'document', sourceId: 'assistant_document_1', internal: true }],
        eligibleSourceIds: null,
      })
    )
    expect(verdict).toMatchObject({ ok: false, code: 'internal_evidence' })
  })

  it('refuses a citation whose source was revoked while the turn was generating', () => {
    const verdict = validateCustomerPublication(input({ eligibleSourceIds: new Set() }))
    expect(verdict).toMatchObject({ ok: false, code: 'revoked_evidence' })
  })

  it('refuses closing the conversation while a receipt is unconfirmed', () => {
    const verdict = validateCustomerPublication(
      input({
        candidate: {
          text: 'All done, closing this off.',
          responseKind: 'answer',
          outcome: 'answer',
          citations: [],
          handoff: false,
          closeRequest: true,
        },
        evidence: [],
        eligibleSourceIds: null,
        receipts: [{ toolName: 'connector_billing__refund', status: 'unknown' }],
      })
    )
    expect(verdict).toMatchObject({ ok: false, code: 'unsettled_action_claim' })
  })

  it('still lets an unconfirmed effect be reported honestly without closing', () => {
    const verdict = validateCustomerPublication(
      input({
        candidate: {
          text: 'I could not confirm the refund went through; a teammate will check.',
          responseKind: 'answer',
          outcome: 'answer',
          citations: [],
          handoff: false,
          closeRequest: false,
        },
        evidence: [],
        eligibleSourceIds: null,
        receipts: [{ toolName: 'connector_billing__refund', status: 'unknown' }],
      })
    )
    expect(verdict).toEqual({ ok: true })
  })

  it('lets a settled receipt close the conversation', () => {
    const verdict = validateCustomerPublication(
      input({
        candidate: {
          text: 'Refunded, closing this off.',
          responseKind: 'answer',
          outcome: 'answer',
          citations: [],
          handoff: false,
          closeRequest: true,
        },
        evidence: [],
        eligibleSourceIds: null,
        receipts: [{ toolName: 'connector_billing__refund', status: 'succeeded' }],
      })
    )
    expect(verdict).toEqual({ ok: true })
  })
})
