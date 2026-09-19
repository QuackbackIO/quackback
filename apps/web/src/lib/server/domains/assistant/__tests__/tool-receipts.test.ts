/**
 * The duplicate-call decision table, read directly.
 *
 * Every case here is a row of the specification's table, and each asserts the
 * thing the row exists to prevent rather than the label it produces: no second
 * effect after a success, no completion claim while somebody else is working,
 * no automatic retry once anything left the database.
 */
import { describe, it, expect } from 'vitest'
import type { AssistantToolCall } from '../tool-receipts'
import {
  boundedResult,
  canonicalJson,
  digestOf,
  logicalActionKey,
  outcomeForInterruptedDispatch,
  replayOutcomeFor,
  settlementFor,
  MAX_RECEIPT_RESULT_BYTES,
} from '../tool-receipts'

function receipt(overrides: Partial<AssistantToolCall> = {}): AssistantToolCall {
  return {
    id: 'assistant_tool_call_1',
    conversationId: null,
    involvementId: null,
    pendingActionId: null,
    toolName: 'issue_refund',
    args: {},
    status: 'started',
    resultSummary: null,
    error: null,
    latencyMs: null,
    idempotencyKey: null,
    principalId: null,
    runId: null,
    runStepKey: null,
    actionKey: null,
    argsDigest: null,
    schemaDigest: null,
    result: null,
    providerReceipt: null,
    providerIdempotencyKey: null,
    dispatchedAt: null,
    settledAt: null,
    outcomeStatus: null,
    retryable: null,
    reconciliationState: null,
    reconciliationNote: null,
    reconciledAt: null,
    reconciledById: null,
    replayStrategy: null,
    createdAt: new Date(),
    ...overrides,
  } as AssistantToolCall
}

describe('canonical digests', () => {
  it('hashes the same for equivalent objects written in a different key order', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe(
      canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 })
    )
    expect(digestOf({ b: 1, a: 2 })).toBe(digestOf({ a: 2, b: 1 }))
  })

  it('hashes differently when a value actually changes', () => {
    expect(digestOf({ amount: 10 })).not.toBe(digestOf({ amount: 11 }))
    // Argument order inside an array is meaning, not formatting.
    expect(digestOf({ ids: ['a', 'b'] })).not.toBe(digestOf({ ids: ['b', 'a'] }))
  })
})

describe('logical action identity', () => {
  it('is the same across two continuations of the same engagement', () => {
    const first = logicalActionKey({
      parentKey: 'conversation_1',
      engagement: 'inv:assistant_involvement_1',
      toolName: 'issue_refund',
      argsDigest: digestOf({ orderId: 'A1' }),
    })
    const continuation = logicalActionKey({
      parentKey: 'conversation_1',
      engagement: 'inv:assistant_involvement_1',
      toolName: 'issue_refund',
      argsDigest: digestOf({ orderId: 'A1' }),
    })
    expect(continuation).toBe(first)
  })

  it('differs across engagements and across arguments', () => {
    const base = {
      parentKey: 'conversation_1',
      engagement: 'inv:assistant_involvement_1',
      toolName: 'issue_refund',
      argsDigest: digestOf({ orderId: 'A1' }),
    }
    expect(logicalActionKey({ ...base, engagement: 'inv:assistant_involvement_2' })).not.toBe(
      logicalActionKey(base)
    )
    expect(logicalActionKey({ ...base, argsDigest: digestOf({ orderId: 'A2' }) })).not.toBe(
      logicalActionKey(base)
    )
  })
})

describe('replayOutcomeFor', () => {
  it('returns the stored result for a succeeded receipt', () => {
    const outcome = replayOutcomeFor(
      receipt({ status: 'succeeded', outcomeStatus: 'succeeded', result: { refundId: 'r_1' } })
    )
    expect(outcome).toEqual({
      status: 'succeeded',
      value: { refundId: 'r_1' },
      receiptId: 'assistant_tool_call_1',
    })
  })

  it('answers a still-running receipt with a wait, never a completion', () => {
    const outcome = replayOutcomeFor(receipt({ status: 'started' }))
    expect(outcome.status).toBe('in_progress')
  })

  it('calls a dispatched receipt with no settlement unknown, not failed', () => {
    const outcome = replayOutcomeFor(receipt({ status: 'started', dispatchedAt: new Date() }))
    expect(outcome).toEqual({
      status: 'unknown',
      receiptId: 'assistant_tool_call_1',
      reconciliationRequired: true,
    })
  })

  it('never marks a dispatched failure retryable', () => {
    const outcome = replayOutcomeFor(
      receipt({
        status: 'failed',
        outcomeStatus: 'failed',
        retryable: true,
        dispatchedAt: new Date(),
        settledAt: new Date(),
        error: 'provider rejected',
      })
    )
    expect(outcome).toEqual({ status: 'failed', reason: 'provider rejected', retryable: false })
  })

  it('allows a retry of a failure that is known to precede the dispatch', () => {
    const outcome = replayOutcomeFor(
      receipt({ status: 'failed', outcomeStatus: 'failed', retryable: true, settledAt: new Date() })
    )
    expect(outcome).toMatchObject({ status: 'failed', retryable: true })
  })

  it('preserves a denial', () => {
    expect(replayOutcomeFor(receipt({ status: 'denied', error: 'no permission' }))).toEqual({
      status: 'denied',
      reason: 'no permission',
    })
  })

  it('keeps a reconciliation-required receipt unknown even when a status word says otherwise', () => {
    const outcome = replayOutcomeFor(
      receipt({ status: 'failed', outcomeStatus: 'failed', reconciliationState: 'required' })
    )
    expect(outcome.status).toBe('unknown')
  })
})

describe('settlementFor', () => {
  it('does not let an unknown outcome reach a terminal coarse status', () => {
    const settled = settlementFor({
      status: 'unknown',
      receiptId: 'assistant_tool_call_1',
      reconciliationRequired: true,
    })
    expect(settled).toMatchObject({
      status: 'started',
      outcomeStatus: 'unknown',
      reconciliationState: 'required',
      retryable: false,
    })
  })

  it('settles a success and a failure into their own coarse statuses', () => {
    expect(settlementFor({ status: 'succeeded', value: {}, receiptId: 'x' })).toMatchObject({
      status: 'succeeded',
      outcomeStatus: 'succeeded',
    })
    expect(settlementFor({ status: 'failed', reason: 'nope', retryable: false })).toMatchObject({
      status: 'failed',
      outcomeStatus: 'failed',
      retryable: false,
    })
  })
})

describe('outcomeForInterruptedDispatch', () => {
  it('is a retryable failure for a local mutation, which commits with its receipt', () => {
    expect(outcomeForInterruptedDispatch('local_transactional', 'r', 'boom')).toEqual({
      status: 'failed',
      reason: 'boom',
      retryable: true,
    })
  })

  it('is unknown for an external effect with no idempotency contract', () => {
    expect(outcomeForInterruptedDispatch('external_uncertain', 'r', 'timeout')).toEqual({
      status: 'unknown',
      receiptId: 'r',
      reconciliationRequired: true,
    })
  })
})

describe('boundedResult', () => {
  it('keeps a small object as it is', () => {
    expect(boundedResult({ ok: true, id: 'x' })).toEqual({ ok: true, id: 'x' })
  })

  it('truncates a result too large to carry back into a prompt', () => {
    const big = { blob: 'x'.repeat(MAX_RECEIPT_RESULT_BYTES * 2) }
    const bounded = boundedResult(big)
    expect(bounded?.truncated).toBe(true)
    expect(JSON.stringify(bounded).length).toBeLessThan(MAX_RECEIPT_RESULT_BYTES * 2)
  })
})
