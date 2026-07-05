/**
 * Real-DB coverage for getGuidanceRuleStats — the per-rule Used/Resolved %
 * aggregation the guidance rules card shows on each rule (mirrors Fin's
 * Guidance table). Runs inside the rollback fixture transaction: seeds
 * ai_usage_log turns (assistant.runtime's recorded guidanceRuleIds) and
 * assistant_involvements outcomes, then asserts the fold-together.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type ConversationId } from '@quackback/ids'

// Domain code imports the global `db`; rebind it to the test transaction.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  aiUsageLog,
  assistantInvolvements,
  conversations,
  principal,
  user,
  type AssistantInvolvementStatus,
} from '@/lib/server/db'
import { getGuidanceRuleStats, computeResolvedPct } from '../guidance-stats'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: aiUsageLog.id }).from(aiUsageLog).limit(0)
    await db.select({ id: assistantInvolvements.id }).from(assistantInvolvements).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedVisitor(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `V-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'anonymous', createdAt: new Date() })
  return principalId
}

async function seedConversation(): Promise<ConversationId> {
  const id = createId('conversation') as ConversationId
  const visitorPrincipalId = await seedVisitor()
  await testDb.insert(conversations).values({ id, visitorPrincipalId, channel: 'messenger' })
  return id
}

async function seedInvolvement(
  conversationId: ConversationId,
  status: AssistantInvolvementStatus,
  createdAt?: Date
) {
  await testDb
    .insert(assistantInvolvements)
    .values({ conversationId, triggeredBy: 'first_touch', status, createdAt })
}

async function seedTurn(
  conversationId: ConversationId | null,
  guidanceRuleIds: string[] | undefined,
  over: { status?: 'success' | 'error'; pipelineStep?: string; createdAt?: Date } = {}
) {
  const metadata: Record<string, unknown> = { conversationId, attempt: 0 }
  if (guidanceRuleIds !== undefined) metadata.guidanceRuleIds = guidanceRuleIds
  await testDb.insert(aiUsageLog).values({
    pipelineStep: over.pipelineStep ?? 'assistant',
    callType: 'chat_completion',
    model: 'test-model',
    inputTokens: 1,
    totalTokens: 1,
    durationMs: 1,
    status: over.status ?? 'success',
    metadata,
    ...(over.createdAt ? { createdAt: over.createdAt } : {}),
  })
}

describe('computeResolvedPct (pure)', () => {
  it('is null (never NaN) when nothing used the rule', () => {
    expect(computeResolvedPct(0, 0)).toBeNull()
  })

  it('is the resolved/used percent, 0-100', () => {
    expect(computeResolvedPct(2, 2)).toBe(100)
    expect(computeResolvedPct(4, 1)).toBe(25)
  })
})

describe.skipIf(!fixture.available)('getGuidanceRuleStats (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('counts 2 turns of a rule in a resolved conversation as 100% resolved', async () => {
    const conversationId = await seedConversation()
    await seedInvolvement(conversationId, 'resolved_confirmed')
    await seedTurn(conversationId, ['assistant_guidance_a'])
    await seedTurn(conversationId, ['assistant_guidance_a'])

    const stats = await getGuidanceRuleStats()
    expect(stats.assistant_guidance_a).toEqual({ used: 2, resolved: 2, resolvedPct: 100 })
  })

  it('is absent (not a NaN entry) for a rule with zero turns', async () => {
    const conversationId = await seedConversation()
    await seedInvolvement(conversationId, 'resolved_confirmed')
    await seedTurn(conversationId, ['assistant_guidance_a'])

    const stats = await getGuidanceRuleStats()
    expect(stats.assistant_guidance_never_used).toBeUndefined()
  })

  it('does not count an escalated (handed_off) conversation as resolved', async () => {
    const conversationId = await seedConversation()
    await seedInvolvement(conversationId, 'handed_off')
    await seedTurn(conversationId, ['assistant_guidance_b'])

    const stats = await getGuidanceRuleStats()
    expect(stats.assistant_guidance_b).toEqual({ used: 1, resolved: 0, resolvedPct: 0 })
  })

  it('counts an assumed resolution as resolved too (both resolved-bucket statuses)', async () => {
    const conversationId = await seedConversation()
    await seedInvolvement(conversationId, 'resolved_assumed')
    await seedTurn(conversationId, ['assistant_guidance_c'])

    const stats = await getGuidanceRuleStats()
    expect(stats.assistant_guidance_c).toEqual({ used: 1, resolved: 1, resolvedPct: 100 })
  })

  it('mixes resolved and unresolved conversations into a partial resolvedPct', async () => {
    const resolvedConvo = await seedConversation()
    await seedInvolvement(resolvedConvo, 'resolved_confirmed')
    await seedTurn(resolvedConvo, ['assistant_guidance_d'])

    const activeConvo = await seedConversation()
    await seedInvolvement(activeConvo, 'active')
    await seedTurn(activeConvo, ['assistant_guidance_d'])
    await seedTurn(activeConvo, ['assistant_guidance_d'])

    const stats = await getGuidanceRuleStats()
    expect(stats.assistant_guidance_d).toEqual({
      used: 3,
      resolved: 1,
      resolvedPct: 33, // round(1/3 * 100)
    })
  })

  it('splits multi-rule turns: each rule id in the array gets its own use', async () => {
    const conversationId = await seedConversation()
    await seedInvolvement(conversationId, 'resolved_confirmed')
    await seedTurn(conversationId, ['assistant_guidance_e', 'assistant_guidance_f'])

    const stats = await getGuidanceRuleStats()
    expect(stats.assistant_guidance_e).toEqual({ used: 1, resolved: 1, resolvedPct: 100 })
    expect(stats.assistant_guidance_f).toEqual({ used: 1, resolved: 1, resolvedPct: 100 })
  })

  it('ignores turns with no guidanceRuleIds key (flag off / no guidance)', async () => {
    const conversationId = await seedConversation()
    await seedInvolvement(conversationId, 'resolved_confirmed')
    await seedTurn(conversationId, undefined)

    const stats = await getGuidanceRuleStats()
    expect(stats).toEqual({})
  })

  it('ignores turns with an empty guidanceRuleIds array', async () => {
    const conversationId = await seedConversation()
    await seedInvolvement(conversationId, 'resolved_confirmed')
    await seedTurn(conversationId, [])

    const stats = await getGuidanceRuleStats()
    expect(stats).toEqual({})
  })

  it('excludes non-assistant pipeline steps and non-success turns', async () => {
    const conversationId = await seedConversation()
    await seedInvolvement(conversationId, 'resolved_confirmed')
    await seedTurn(conversationId, ['assistant_guidance_g'], { status: 'error' })
    await seedTurn(conversationId, ['assistant_guidance_g'], { pipelineStep: 'extraction' })

    const stats = await getGuidanceRuleStats()
    expect(stats.assistant_guidance_g).toBeUndefined()
  })

  it('excludes turns older than the ai_usage_log retention window', async () => {
    const conversationId = await seedConversation()
    await seedInvolvement(conversationId, 'resolved_confirmed')
    await seedTurn(conversationId, ['assistant_guidance_stale'], {
      createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
    })

    const stats = await getGuidanceRuleStats()
    expect(stats.assistant_guidance_stale).toBeUndefined()
  })

  it('counts a turn with no linked conversation (sandbox) as used but never resolved', async () => {
    await seedTurn(null, ['assistant_guidance_h'])

    const stats = await getGuidanceRuleStats()
    expect(stats.assistant_guidance_h).toEqual({ used: 1, resolved: 0, resolvedPct: 0 })
  })

  it('joins on the LATEST involvement when a conversation has more than one over time', async () => {
    const conversationId = await seedConversation()
    // Handed off, then re-engaged later and resolved — the latest row wins.
    await seedInvolvement(conversationId, 'handed_off', new Date('2026-07-01T00:00:00.000Z'))
    await seedInvolvement(
      conversationId,
      'resolved_confirmed',
      new Date('2026-07-02T00:00:00.000Z')
    )
    await seedTurn(conversationId, ['assistant_guidance_i'])

    const stats = await getGuidanceRuleStats()
    expect(stats.assistant_guidance_i).toEqual({ used: 1, resolved: 1, resolvedPct: 100 })
  })
})
