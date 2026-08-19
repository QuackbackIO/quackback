import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { aiUsageLog } from '@/lib/server/db'
import { getGuidanceRuleStats } from '../guidance-stats'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: aiUsageLog.id }).from(aiUsageLog).limit(0)
  },
})

async function seedTurn(
  guidanceAppliedIds: unknown,
  overrides: {
    status?: 'success' | 'error'
    pipelineStep?: string
    createdAt?: Date
    metadataKey?: 'guidanceAppliedIds' | 'guidanceRuleIds'
  } = {}
) {
  const metadata = {
    [overrides.metadataKey ?? 'guidanceAppliedIds']: guidanceAppliedIds,
  }
  await testDb.insert(aiUsageLog).values({
    pipelineStep: overrides.pipelineStep ?? 'assistant',
    callType: 'chat_completion',
    model: 'test-model',
    inputTokens: 1,
    totalTokens: 1,
    durationMs: 1,
    status: overrides.status ?? 'success',
    metadata,
    ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
  })
}

describe.skipIf(!fixture.available)('getGuidanceRuleStats (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('returns Applied count and lastAppliedAt only', async () => {
    const first = new Date('2026-07-01T00:00:00.000Z')
    const second = new Date('2026-07-02T00:00:00.000Z')
    await seedTurn(['assistant_guidance_a'], { createdAt: first })
    await seedTurn(['assistant_guidance_a'], { createdAt: second })

    const stats = await getGuidanceRuleStats()
    expect(stats.assistant_guidance_a).toEqual({ applied: 2, lastAppliedAt: second })
    expect(stats.assistant_guidance_a).not.toHaveProperty('resolved')
    expect(stats.assistant_guidance_a).not.toHaveProperty('resolvedPct')
  })

  it('counts each applied rule once per successful turn', async () => {
    await seedTurn(['assistant_guidance_a', 'assistant_guidance_a', 'assistant_guidance_b'])

    const stats = await getGuidanceRuleStats()
    expect(stats.assistant_guidance_a.applied).toBe(1)
    expect(stats.assistant_guidance_b.applied).toBe(1)
  })

  it('ignores V1 metadata, malformed metadata, failed calls, and unrelated pipeline steps', async () => {
    await seedTurn(['assistant_guidance_ignored'], { metadataKey: 'guidanceRuleIds' })
    await seedTurn('not-an-array')
    await seedTurn(['assistant_guidance_ignored'], { status: 'error' })
    await seedTurn(['assistant_guidance_ignored'], { pipelineStep: 'quality_gate' })
    await seedTurn(['assistant_guidance_ignored'], { pipelineStep: 'copilot_suggest' })
    expect(await getGuidanceRuleStats()).toEqual({})
  })

  it('excludes applications older than usage retention', async () => {
    await seedTurn(['assistant_guidance_stale'], {
      createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1_000),
    })
    expect((await getGuidanceRuleStats()).assistant_guidance_stale).toBeUndefined()
  })
})
