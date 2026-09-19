/**
 * The semantic verifier's gates, without a model.
 *
 * Everything here is about when the verifier runs, what a verdict means and
 * what a missing quality-gate model does. The model call itself is covered by
 * the executor cases in assistant-run.durability.db.test.ts, which drive the
 * real decision path with a stubbed verdict.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const qualityGateModel = vi.hoisted(() => vi.fn<() => string | null>(() => null))
vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: qualityGateModel,
  getEmbeddingModel: () => null,
  isVisionCapableModel: () => false,
}))
const runSynthesis = vi.hoisted(() => vi.fn())
vi.mock('../synthesis-core', async (original) => ({
  ...(await original<typeof import('../synthesis-core')>()),
  runSynthesis,
}))

import {
  answerValidationMode,
  verifyAnswerSupport,
  verificationBlocksPublication,
} from '../answer-validation'

const ANSWER = {
  text: 'Refunds land within ten days.',
  responseKind: 'answer',
  handoff: false,
  evidence: [
    {
      sourceType: 'article',
      sourceId: 'article_1',
      chunkId: 'assistant_chunk_1',
      passage: 'Refunds land within ten days.',
    },
  ],
  receipts: [],
}

describe('answerValidationMode', () => {
  const original = process.env.ASSISTANT_ANSWER_VALIDATION
  afterEach(() => {
    if (original === undefined) delete process.env.ASSISTANT_ANSWER_VALIDATION
    else process.env.ASSISTANT_ANSWER_VALIDATION = original
  })

  it('is shadow by default', () => {
    delete process.env.ASSISTANT_ANSWER_VALIDATION
    expect(answerValidationMode()).toBe('shadow')
  })

  it('reads off and enforce', () => {
    process.env.ASSISTANT_ANSWER_VALIDATION = 'off'
    expect(answerValidationMode()).toBe('off')
    process.env.ASSISTANT_ANSWER_VALIDATION = 'ENFORCE'
    expect(answerValidationMode()).toBe('enforce')
  })

  it('resolves a typo to shadow rather than to enforce', () => {
    process.env.ASSISTANT_ANSWER_VALIDATION = 'enforced'
    expect(answerValidationMode()).toBe('shadow')
  })
})

describe('verifyAnswerSupport', () => {
  beforeEach(() => {
    delete process.env.ASSISTANT_ANSWER_VALIDATION
    qualityGateModel.mockReturnValue(null)
    runSynthesis.mockReset()
  })
  afterEach(() => {
    delete process.env.ASSISTANT_ANSWER_VALIDATION
  })

  it('stands down with a recorded reason when no quality-gate model is configured', async () => {
    const verification = await verifyAnswerSupport(ANSWER)
    expect(verification).toMatchObject({
      mode: 'shadow',
      ran: false,
      verdict: null,
      skippedReason: 'no_quality_gate_model',
    })
    expect(runSynthesis).not.toHaveBeenCalled()
  })

  it('does not run at all when the mode is off', async () => {
    process.env.ASSISTANT_ANSWER_VALIDATION = 'off'
    qualityGateModel.mockReturnValue('gate-model')
    const verification = await verifyAnswerSupport(ANSWER)
    expect(verification).toMatchObject({ ran: false, skippedReason: 'mode_off' })
    expect(runSynthesis).not.toHaveBeenCalled()
  })

  it('does not ask for evidence behind a greeting or a hand-off', async () => {
    qualityGateModel.mockReturnValue('gate-model')
    for (const candidate of [
      { ...ANSWER, responseKind: 'greeting' },
      { ...ANSWER, responseKind: 'clarification' },
      { ...ANSWER, handoff: true },
    ]) {
      const verification = await verifyAnswerSupport(candidate)
      expect(verification).toMatchObject({ ran: false, skippedReason: 'no_material_claim' })
    }
    expect(runSynthesis).not.toHaveBeenCalled()
  })

  it('returns the model verdict for a substantive answer', async () => {
    qualityGateModel.mockReturnValue('gate-model')
    runSynthesis.mockResolvedValue({
      outcome: 'success',
      final: {
        verdict: 'unsupported',
        reason: 'No passage mentions an expedited replacement.',
        evidenceRefs: ['assistant_chunk_1'],
      },
    })
    const verification = await verifyAnswerSupport(ANSWER)
    expect(verification).toMatchObject({
      ran: true,
      verdict: 'unsupported',
      reason: 'No passage mentions an expedited replacement.',
      evidenceRefs: ['assistant_chunk_1'],
      model: 'gate-model',
    })
  })

  it('reports validator_error rather than a pass when the verifier throws', async () => {
    qualityGateModel.mockReturnValue('gate-model')
    runSynthesis.mockRejectedValue(new Error('provider down'))
    const verification = await verifyAnswerSupport(ANSWER)
    expect(verification).toMatchObject({ ran: true, verdict: 'validator_error' })
  })

  it('carries the receipts so an action claim can be checked against them', async () => {
    qualityGateModel.mockReturnValue('gate-model')
    runSynthesis.mockResolvedValue({
      outcome: 'success',
      final: { verdict: 'supported', reason: 'ok', evidenceRefs: [] },
    })
    await verifyAnswerSupport({
      ...ANSWER,
      receipts: [{ toolName: 'connector_billing__refund', status: 'unknown' }],
    })
    const payload = JSON.parse(runSynthesis.mock.calls[0][0].messages[0].content)
    expect(payload.receipts).toEqual([{ tool: 'connector_billing__refund', outcome: 'unknown' }])
    expect(payload.evidence[0]).toMatchObject({ id: 'assistant_chunk_1', kind: 'article' })
  })
})

describe('verificationBlocksPublication', () => {
  const base = {
    ran: true as const,
    skippedReason: null,
    reason: null,
    evidenceRefs: [] as string[],
    model: 'gate-model',
  }

  it('never blocks in shadow mode, whatever the verdict', () => {
    for (const verdict of [
      'unsupported',
      'conflicting',
      'insufficient',
      'validator_error',
    ] as const) {
      expect(verificationBlocksPublication({ ...base, mode: 'shadow', verdict })).toBe(false)
    }
  })

  it('blocks every non-supported verdict in enforced mode', () => {
    for (const verdict of ['unsupported', 'conflicting', 'insufficient'] as const) {
      expect(verificationBlocksPublication({ ...base, mode: 'enforce', verdict })).toBe(true)
    }
  })

  it('treats a validator outage as unchecked rather than as resolved', () => {
    expect(
      verificationBlocksPublication({ ...base, mode: 'enforce', verdict: 'validator_error' })
    ).toBe(true)
  })

  it('publishes a supported answer in enforced mode', () => {
    expect(verificationBlocksPublication({ ...base, mode: 'enforce', verdict: 'supported' })).toBe(
      false
    )
  })

  it('does not block when the verifier never ran', () => {
    expect(
      verificationBlocksPublication({
        mode: 'enforce',
        ran: false,
        verdict: null,
        skippedReason: 'no_quality_gate_model',
        reason: null,
        evidenceRefs: [],
        model: null,
      })
    ).toBe(false)
  })
})
