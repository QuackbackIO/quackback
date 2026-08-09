/**
 * The outcome usage ledger.
 *
 * The pricing model charges per resolved AI outcome, so a duplicate row here
 * is a duplicate charge. Two things have to hold and neither can be checked
 * without a database, because both are enforced by a unique index:
 *
 *  - re-running the derivation never bills the same conversation twice;
 *  - a resolution that is *undone* and later re-made is still one outcome.
 *
 * The second is not hypothetical: `voidAssumedResolutionForConversation()`
 * moves an assumed resolution back to `active` when the customer returns
 * needing help, and the conversation can then resolve again. A counter
 * incremented at resolution time would charge twice for one conversation.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type AssistantInvolvementId,
  type ConversationId,
  type PrincipalId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  assistantInvolvements,
  billingUsageEvents,
  conversations,
  eq,
  principal,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { deriveOutcomeUsage, pushOutcomeUsage, usageSummary, OUTCOME_METER } = await import(
  '../usage'
)
import type { BillingProviderClient } from '../provider/client'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: billingUsageEvents.id }).from(billingUsageEvents).limit(0)
    await db.select({ id: assistantInvolvements.id }).from(assistantInvolvements).limit(0)
  },
})

const CONFIG = {
  catalogue: {
    pro: { seat: 'price_seat', outcome: 'price_outcome', outcomeMeter: 'quackback_outcome' },
    free: { seat: 'price_free_seat' },
  },
} as unknown as Parameters<typeof pushOutcomeUsage>[2]

/** A visitor principal, required by `conversations.visitor_principal_id`. */
async function addVisitor(): Promise<PrincipalId> {
  const id = createId('principal')
  await testDb
    .insert(principal)
    .values({ id, role: 'user', type: 'anonymous', createdAt: new Date() })
  return id
}

async function addInvolvement(
  status: 'active' | 'handed_off' | 'resolved_confirmed' | 'resolved_assumed' | 'abandoned',
  endedAt: Date | null = new Date('2026-04-01T00:00:00.000Z')
): Promise<AssistantInvolvementId> {
  const conversationId: ConversationId = createId('conversation')
  await testDb.insert(conversations).values({
    id: conversationId,
    visitorPrincipalId: await addVisitor(),
    // channel has no DB default (0125 dropped it deliberately), so every
    // insert must name it.
    channel: 'messenger',
    subject: 'Test',
  })
  const id = createId('assistant_involvement')
  await testDb.insert(assistantInvolvements).values({
    id,
    conversationId,
    triggeredBy: 'first_touch',
    status,
    endedAt,
    createdAt: new Date('2026-03-31T00:00:00.000Z'),
  })
  return id
}

async function ledgerSourceIds(): Promise<string[]> {
  const rows = await testDb
    .select({ sourceId: billingUsageEvents.sourceId })
    .from(billingUsageEvents)
    .where(eq(billingUsageEvents.meter, OUTCOME_METER))
  return rows.map((row) => row.sourceId).sort()
}

beforeEach(async () => {
  await fixture.begin()
  await testDb.delete(billingUsageEvents)
  await testDb.delete(assistantInvolvements)
})

afterEach(async () => {
  await fixture.rollback()
  vi.clearAllMocks()
})

afterAll(async () => {
  await fixture.close()
})

describe.skipIf(!fixture.available)('outcome usage ledger', () => {
  it('bills both resolved statuses and nothing else', async () => {
    const confirmed = await addInvolvement('resolved_confirmed')
    const assumed = await addInvolvement('resolved_assumed')
    // Not billable: the assistant did not resolve these.
    await addInvolvement('active', null)
    await addInvolvement('handed_off')
    await addInvolvement('abandoned')

    const result = await deriveOutcomeUsage()
    expect(result.created).toBe(2)
    expect(await ledgerSourceIds()).toEqual([confirmed, assumed].sort())
  })

  it('is idempotent across repeated derivations', async () => {
    await addInvolvement('resolved_confirmed')
    await addInvolvement('resolved_assumed')

    const first = await deriveOutcomeUsage()
    const second = await deriveOutcomeUsage()
    const third = await deriveOutcomeUsage()

    expect(first.created).toBe(2)
    expect(second).toEqual({ created: 0, candidates: 2 })
    expect(third).toEqual({ created: 0, candidates: 2 })
    expect(await ledgerSourceIds()).toHaveLength(2)
  })

  it('bills a voided-then-re-resolved conversation exactly once', async () => {
    const id = await addInvolvement('resolved_assumed')
    await deriveOutcomeUsage()
    expect(await ledgerSourceIds()).toEqual([id])

    // The customer came back: the product moves the involvement back to
    // active. The ledger row stays — we already billed for the resolution.
    await testDb
      .update(assistantInvolvements)
      .set({ status: 'active', endedAt: null })
      .where(eq(assistantInvolvements.id, id))
    await deriveOutcomeUsage()
    expect(await ledgerSourceIds()).toEqual([id])

    // It resolves again. Same conversation, same outcome, one charge.
    await testDb
      .update(assistantInvolvements)
      .set({ status: 'resolved_confirmed', endedAt: new Date('2026-04-05T00:00:00.000Z') })
      .where(eq(assistantInvolvements.id, id))
    await deriveOutcomeUsage()
    expect(await ledgerSourceIds()).toEqual([id])
  })

  it('never bills a resolution that was undone before the sweep saw it', async () => {
    // Deriving from current state, rather than counting at resolution time,
    // is what makes this possible at all.
    const id = await addInvolvement('resolved_assumed')
    await testDb
      .update(assistantInvolvements)
      .set({ status: 'active', endedAt: null })
      .where(eq(assistantInvolvements.id, id))

    expect(await deriveOutcomeUsage()).toEqual({ created: 0, candidates: 0 })
    expect(await ledgerSourceIds()).toEqual([])
  })

  it('excludes resolutions after the requested boundary', async () => {
    await addInvolvement('resolved_confirmed', new Date('2026-04-01T00:00:00.000Z'))
    await addInvolvement('resolved_confirmed', new Date('2026-06-01T00:00:00.000Z'))
    const result = await deriveOutcomeUsage(new Date('2026-05-01T00:00:00.000Z'))
    expect(result).toEqual({ created: 1, candidates: 1 })
  })

  it('reports each ledger row once, keyed by its own id', async () => {
    await addInvolvement('resolved_confirmed')
    await addInvolvement('resolved_assumed')
    await deriveOutcomeUsage()

    const reported: Array<{ identifier: string; meter: string; value: number }> = []
    const client = {
      reportMeterEvent: vi.fn(async (input: { identifier: string; meter: string; value: number }) => {
        reported.push(input)
      }),
    } as unknown as BillingProviderClient

    const first = await pushOutcomeUsage(client, 'cus_1', CONFIG, 'pro')
    expect(first).toEqual({ reported: 2, failed: 0 })
    expect(reported.map((r) => r.meter)).toEqual(['quackback_outcome', 'quackback_outcome'])
    expect(reported.map((r) => r.value)).toEqual([1, 1])
    // The identifier IS the ledger row id, which is what makes the provider
    // side idempotent even if the local flag write is lost.
    expect(reported.map((r) => r.identifier).sort()).toEqual(
      (await testDb.select({ id: billingUsageEvents.id }).from(billingUsageEvents))
        .map((r) => r.id)
        .sort()
    )

    // Nothing left to push.
    const second = await pushOutcomeUsage(client, 'cus_1', CONFIG, 'pro')
    expect(second).toEqual({ reported: 0, failed: 0 })
    expect(reported).toHaveLength(2)
  })

  it('leaves a row unreported when the provider call fails, and retries it later', async () => {
    await addInvolvement('resolved_confirmed')
    await deriveOutcomeUsage()

    let shouldFail = true
    const client = {
      reportMeterEvent: vi.fn(async () => {
        if (shouldFail) throw new Error('rate limited')
      }),
    } as unknown as BillingProviderClient

    expect(await pushOutcomeUsage(client, 'cus_1', CONFIG, 'pro')).toEqual({
      reported: 0,
      failed: 1,
    })
    expect(await usageSummary(new Date('2026-01-01'))).toEqual({
      total: 1,
      reported: 0,
      pending: 1,
    })

    shouldFail = false
    expect(await pushOutcomeUsage(client, 'cus_1', CONFIG, 'pro')).toEqual({
      reported: 1,
      failed: 0,
    })
    expect(await usageSummary(new Date('2026-01-01'))).toEqual({
      total: 1,
      reported: 1,
      pending: 0,
    })
  })

  it('still records usage on a plan that does not charge for it', async () => {
    // The ledger is the record of what happened, not of what was sold. A plan
    // that bundles outcomes into its seat price simply has nothing to report.
    await addInvolvement('resolved_confirmed')
    await deriveOutcomeUsage()

    const client = { reportMeterEvent: vi.fn() } as unknown as BillingProviderClient
    expect(await pushOutcomeUsage(client, 'cus_1', CONFIG, 'free')).toEqual({
      reported: 0,
      failed: 0,
    })
    expect(client.reportMeterEvent).not.toHaveBeenCalled()
    expect(await ledgerSourceIds()).toHaveLength(1)
  })
})
