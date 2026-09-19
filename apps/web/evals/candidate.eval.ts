/**
 * Exact-candidate suite (QUINN-PRODUCT P7, specification §12).
 *
 * The third thing the release gate needs from the harness: a suite that runs
 * against a PARTICULAR candidate rather than against whatever the settings row
 * says now, with its results stored per candidate so they stop counting the
 * moment the candidate moves.
 *
 * Structural by construction, so it needs no provider: every scenario here is a
 * toolset scenario, which asserts on the assembled tool set with no model call.
 * The model-backed suite against a candidate is `scenarios.eval.ts` run with
 * the same `candidate` option, which is opt-in because it spends provider
 * budget; the release gate does not require it for exactly that reason.
 *
 * Run it from the repo root against a migrated disposable database:
 *   DATABASE_URL=... bun vitest run --config apps/web/evals/vitest.config.ts \
 *     apps/web/evals/candidate.eval.ts
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'

// Rebind the global db to the rollback transaction (README pattern #1).
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
// No provider: the structural suite must be deterministic and free to run.
vi.mock('@/lib/server/domains/ai/models', () => ({
  getEmbeddingModel: () => null,
  getChatModel: () => null,
  isVisionCapableModel: () => false,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { assistantReleases, eq, settings } from '@/lib/server/db'
import {
  ensureDraftCandidate,
  getReleaseState,
  recordReleaseCheckResult,
} from '@/lib/server/domains/assistant/assistant-release.service'
import { candidateBehaviour } from '@/lib/server/domains/assistant/assistant-release.behaviour'
import { setReleaseManagement } from '@/lib/server/domains/assistant/assistant-release.publish'
import {
  getAssistantSettings,
  updateAssistantAgentKnowledge,
} from '@/lib/server/domains/settings/settings.assistant'
import { seedAssistantPrincipal } from './harness/seed'
import { runScenario, type CandidateTarget } from './harness/run'
import type { ToolsetScenario } from './types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantReleases.id }).from(assistantReleases).limit(0)
  },
})

/**
 * The two halves of one contract: the live-status source is the toggle that
 * decides whether `get_status` is assembled at all, so a candidate with it on
 * and a candidate with it off are distinguishable with no model call and no
 * seeded corpus.
 */
const statusIsOffered: ToolsetScenario = {
  id: 'C1',
  title: 'a candidate with the status source on offers get_status',
  kind: 'toolset',
  roles: ['customer_support'],
  structural: [{ type: 'toolPresent', name: 'get_status' }],
}

const statusIsWithheld: ToolsetScenario = {
  id: 'C2',
  title: 'a candidate with the status source off offers no get_status',
  kind: 'toolset',
  roles: ['customer_support'],
  structural: [{ type: 'toolAbsent', name: 'get_status' }],
}

describe.skipIf(!fixture.available)('exact-candidate suite', () => {
  beforeEach(async () => {
    await fixture.begin()
    await testDb.delete(assistantReleases)
    // The harness normally runs against a seeded workspace; create the one row
    // it needs when the disposable database has none, so this suite is
    // runnable against a bare migrated database like the rest of the gate.
    const existing = await testDb.select({ id: settings.id }).from(settings).limit(1)
    if (existing.length === 0) {
      await testDb.insert(settings).values({
        name: 'Candidate workspace',
        slug: `cand_${Math.random().toString(36).slice(2, 10)}`,
        createdAt: new Date(),
      })
    } else {
      await testDb
        .update(settings)
        .set({ assistantReleaseManagement: false, assistantPublishedReleaseId: null })
    }
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  async function target(): Promise<CandidateTarget> {
    const draft = await ensureDraftCandidate()
    const behaviour = await candidateBehaviour(draft)
    return {
      runtimeConfig: {
        config: behaviour.config,
        revision: behaviour.configRevision,
        workspaceName: behaviour.workspaceName,
      },
      candidateHash: draft.candidateHash,
    }
  }

  async function setCustomerStatusSource(status: boolean) {
    const current = await getAssistantSettings()
    await updateAssistantAgentKnowledge(
      current.revision,
      { agent: 'agent', knowledge: { ...current.config.agents.agent.knowledge, status } },
      { userId: null, email: null, role: 'admin', type: 'user' }
    )
  }

  it('runs the suite against the exact candidate, not against the live row', async () => {
    await setCustomerStatusSource(true)
    const withStatus = await target()

    // The settings row moves on. The candidate captured above must not.
    await setCustomerStatusSource(false)
    const withoutStatus = await target()

    expect(withStatus.candidateHash).not.toBe(withoutStatus.candidateHash)
    expect(
      (await runScenario(statusIsOffered, 'customer_support', { candidate: withStatus })).failures
    ).toEqual([])
    expect(
      (await runScenario(statusIsWithheld, 'customer_support', { candidate: withoutStatus }))
        .failures
    ).toEqual([])
    // And the candidate really is what decided it: the same scenario against
    // the other candidate fails.
    expect(
      (await runScenario(statusIsOffered, 'customer_support', { candidate: withoutStatus }))
        .failures
    ).not.toEqual([])
  })

  it('stores a real result per candidate, and stops counting it once the candidate moves', async () => {
    const reviewer = await seedAssistantPrincipal()
    await setReleaseManagement(true, reviewer)
    await setCustomerStatusSource(true)

    const reviewed = await ensureDraftCandidate()
    const outcome = await runScenario(statusIsOffered, 'customer_support', {
      candidate: await target(),
    })
    await recordReleaseCheckResult({
      releaseId: reviewed.id,
      checkKey: 'toolset',
      status: outcome.failures.length === 0 ? 'passed' : 'failed',
      candidateHash: reviewed.candidateHash,
      summary: `${statusIsOffered.id} ${outcome.failures.length === 0 ? 'passed' : 'failed'}`,
      ranById: reviewer,
    })

    const stored = await getReleaseState()
    expect(stored.checks.map((check) => [check.key, check.status])).toEqual([['toolset', 'passed']])
    expect(stored.checks[0].candidateHash).toBe(reviewed.candidateHash)

    // An edit to the candidate leaves the result on the row and out of date.
    await setCustomerStatusSource(false)
    const after = await getReleaseState()
    expect(after.draft!.candidateHash).not.toBe(reviewed.candidateHash)
    expect(after.checks[0].candidateHash).toBe(reviewed.candidateHash)
    expect(after.gate.publishable).toBe(false)
    expect(after.gate.blocking.some((entry) => entry.reason === 'stale')).toBe(true)
  })

  it('leaves the live release alone while the suite runs against a candidate', async () => {
    const reviewer = await seedAssistantPrincipal()
    await setCustomerStatusSource(true)
    await setReleaseManagement(true, reviewer)
    const [live] = await testDb
      .select()
      .from(assistantReleases)
      .where(eq(assistantReleases.status, 'published'))

    await setCustomerStatusSource(false)
    await runScenario(statusIsWithheld, 'customer_support', { candidate: await target() })

    const [stillLive] = await testDb
      .select()
      .from(assistantReleases)
      .where(eq(assistantReleases.status, 'published'))
    expect(stillLive.id).toBe(live.id)
    expect(stillLive.candidateHash).toBe(live.candidateHash)
  })
})
