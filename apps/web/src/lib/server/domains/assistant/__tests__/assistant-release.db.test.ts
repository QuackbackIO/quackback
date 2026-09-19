/**
 * Releases, the publication gate and what a run selects, against a real
 * database (QUINN-PRODUCT Step 10, P7).
 *
 * The properties under test are the ones a release is FOR: evidence belongs to
 * one exact candidate and stops being evidence when the candidate moves, a
 * required check that is anything but passed stops the publish, a save racing
 * the publish stops it too, and publication and rollback change what the NEXT
 * run selects without touching a run that already selected.
 *
 * Everything runs inside the fixture's transaction. The concurrency properties
 * here are about compare-and-set logic under the settings row lock rather than
 * about two processes, which is why they are provable this way: each one is
 * driven by making the state move the way a second writer would move it, and
 * each was checked by removing its guard and confirming the case fails.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { assistantReleases, principal, settings, eq } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// The candidate builder reads the embedding model and the chat model; neither
// is configured in this suite, which is the ordinary self-hosted shape.
vi.mock('@/lib/server/domains/ai/models', () => ({
  getEmbeddingModel: () => null,
  getChatModel: () => null,
  isVisionCapableModel: () => false,
}))

import {
  getReleaseState,
  publishCandidate,
  recordReleaseCheckResult,
  rollbackToRelease,
  selectRunBehaviour,
  setReleaseManagement,
} from '../assistant-release.service'
import { RELEASE_CHECKS } from '@/lib/shared/assistant/release'
import {
  getAssistantRuntimeConfig,
  getAssistantSettings,
  updateAssistantVoice,
} from '@/lib/server/domains/settings/settings.assistant'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantReleases.id }).from(assistantReleases).limit(0)
  },
})

describe.skipIf(!fixture.available)('Quinn releases (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    await testDb.delete(assistantReleases)
    const existing = await testDb.select({ id: settings.id }).from(settings).limit(1)
    if (existing.length === 0) {
      await testDb.insert(settings).values({
        name: 'Release workspace',
        slug: `rel_${Math.random().toString(36).slice(2, 10)}`,
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

  async function reviewer(): Promise<PrincipalId> {
    const [row] = await testDb
      .insert(principal)
      .values({ role: 'admin', type: 'user', createdAt: new Date() })
      .returning()
    return row.id
  }

  const actor = { userId: null, email: null, role: 'admin', type: 'user' as const }

  async function passRequiredChecks(releaseId: string, candidateHash: string) {
    for (const check of RELEASE_CHECKS.filter((entry) => entry.required)) {
      await recordReleaseCheckResult({
        releaseId: releaseId as never,
        checkKey: check.key,
        status: 'passed',
        candidateHash,
      })
    }
  }

  /** Change the draft's behaviour through the real write funnel. */
  async function editVoice(tone: 'professional' | 'warm') {
    const current = await getAssistantSettings()
    await updateAssistantVoice(
      current.revision,
      { ...current.config.agents.agent.voice, tone },
      actor
    )
  }

  it('opting in publishes the current behaviour, so the moment of opt-in changes nothing', async () => {
    const before = await getAssistantRuntimeConfig()
    const who = await reviewer()
    const live = await setReleaseManagement(true, who)

    expect(live).not.toBeNull()
    expect(live!.releaseNumber).toBe(1)
    expect(live!.status).toBe('published')
    const after = await getAssistantRuntimeConfig()
    expect(after.config).toEqual(before.config)
    expect(after.releaseId).toBe(live!.id)
  })

  it('leaves the settings row live while release management is off', async () => {
    await editVoice('professional')
    const runtime = await getAssistantRuntimeConfig()
    expect(runtime.config.agents.agent.voice.tone).toBe('professional')
    expect(runtime.releaseId).toBeUndefined()
  })

  it('makes a save a draft candidate rather than live behaviour', async () => {
    const who = await reviewer()
    await setReleaseManagement(true, who)
    const published = (await getReleaseState()).live!

    await editVoice('professional')

    const runtime = await getAssistantRuntimeConfig()
    expect(runtime.config.agents.agent.voice.tone).not.toBe('professional')
    expect(runtime.releaseId).toBe(published.id)

    const state = await getReleaseState()
    expect(state.draft!.candidateHash).not.toBe(published.candidateHash)
    expect(state.draftMatchesLive).toBe(false)
    expect(state.draft!.scope?.uses).toEqual(['customer'])
    expect(state.draft!.scope?.changedPaths).toContain('agents.agent.voice.tone')
  })

  it('refuses a publication with no evidence for the candidate', async () => {
    const who = await reviewer()
    await setReleaseManagement(true, who)
    await editVoice('professional')
    const state = await getReleaseState()
    expect(state.gate.publishable).toBe(false)

    await expect(
      publishCandidate({
        expectedCandidateHash: state.draft!.candidateHash,
        principalId: who,
      })
    ).rejects.toMatchObject({ code: 'ASSISTANT_RELEASE_CHECKS_INCOMPLETE' })
  })

  it.each(['skipped', 'failed', 'inconclusive'] as const)(
    'refuses a publication when a required check came back %s',
    async (status) => {
      const who = await reviewer()
      await setReleaseManagement(true, who)
      await editVoice('professional')
      const state = await getReleaseState()
      await passRequiredChecks(state.draft!.id, state.draft!.candidateHash)
      const firstRequired = RELEASE_CHECKS.find((check) => check.required)!
      await recordReleaseCheckResult({
        releaseId: state.draft!.id,
        checkKey: firstRequired.key,
        status,
        candidateHash: state.draft!.candidateHash,
      })

      await expect(
        publishCandidate({
          expectedCandidateHash: state.draft!.candidateHash,
          principalId: who,
        })
      ).rejects.toMatchObject({ code: 'ASSISTANT_RELEASE_CHECKS_INCOMPLETE' })
    }
  )

  it('invalidates the evidence when the candidate is edited after the checks passed', async () => {
    const who = await reviewer()
    await setReleaseManagement(true, who)
    await editVoice('professional')
    const reviewed = await getReleaseState()
    await passRequiredChecks(reviewed.draft!.id, reviewed.draft!.candidateHash)
    expect((await getReleaseState()).gate.publishable).toBe(true)

    await editVoice('warm')

    const after = await getReleaseState()
    expect(after.draft!.candidateHash).not.toBe(reviewed.draft!.candidateHash)
    expect(after.gate.publishable).toBe(false)
    expect(after.gate.blocking.every((entry) => entry.reason === 'stale')).toBe(true)
    // And the evidence rows are still there, still naming what they tested.
    expect(
      after.checks.every((check) => check.candidateHash === reviewed.draft!.candidateHash)
    ).toBe(true)

    await expect(
      publishCandidate({
        expectedCandidateHash: reviewed.draft!.candidateHash,
        principalId: who,
      })
    ).rejects.toMatchObject({ code: 'ASSISTANT_RELEASE_CANDIDATE_CONFLICT' })
  })

  it('refuses a publication when a save landed after the candidate was reviewed', async () => {
    const who = await reviewer()
    await setReleaseManagement(true, who)
    await editVoice('professional')
    const state = await getReleaseState()
    await passRequiredChecks(state.draft!.id, state.draft!.candidateHash)

    // A concurrent save moves the config revision. The content hash this
    // publication was reviewed against is unchanged, so only the revision
    // comparison taken under the settings row lock can catch it.
    const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    await testDb
      .update(settings)
      .set({ assistantConfigRevision: state.draft!.configRevision + 1 })
      .where(eq(settings.id, row.id))

    await expect(
      publishCandidate({
        expectedCandidateHash: state.draft!.candidateHash,
        principalId: who,
      })
    ).rejects.toMatchObject({ code: 'ASSISTANT_RELEASE_CANDIDATE_CONFLICT' })
  })

  it('publishes a reviewed candidate and selects it for new runs', async () => {
    const who = await reviewer()
    await setReleaseManagement(true, who)
    const first = (await getReleaseState()).live!
    await editVoice('professional')
    const state = await getReleaseState()
    await passRequiredChecks(state.draft!.id, state.draft!.candidateHash)

    const published = await publishCandidate({
      expectedCandidateHash: state.draft!.candidateHash,
      note: 'Warmer replies',
      principalId: who,
    })

    expect(published.status).toBe('published')
    expect(published.releaseNumber).toBe(2)
    expect(published.previousReleaseId).toBe(first.id)
    expect(published.note).toBe('Warmer replies')
    expect(published.publishedByPrincipalId).toBe(who)

    const runtime = await getAssistantRuntimeConfig()
    expect(runtime.config.agents.agent.voice.tone).toBe('professional')
    expect(runtime.releaseId).toBe(published.id)

    const behaviour = await selectRunBehaviour()
    expect(behaviour.releaseId).toBe(published.id)
    expect(behaviour.snapshotId).toBe(published.snapshotId)
    expect(behaviour.config?.agents.agent.voice.tone).toBe('professional')
  })

  it('has nothing to publish a second time once the candidate became the release', async () => {
    const who = await reviewer()
    await setReleaseManagement(true, who)
    await editVoice('professional')
    const state = await getReleaseState()
    await passRequiredChecks(state.draft!.id, state.draft!.candidateHash)
    await publishCandidate({
      expectedCandidateHash: state.draft!.candidateHash,
      principalId: who,
    })

    await expect(
      publishCandidate({
        expectedCandidateHash: state.draft!.candidateHash,
        principalId: who,
      })
    ).rejects.toMatchObject({ code: 'ASSISTANT_RELEASE_NOT_FOUND' })
  })

  it('rolls back to the previous release for new runs, leaving an in-flight run on its own snapshot', async () => {
    const who = await reviewer()
    await setReleaseManagement(true, who)
    const first = (await getReleaseState()).live!
    await editVoice('professional')
    const state = await getReleaseState()
    await passRequiredChecks(state.draft!.id, state.draft!.candidateHash)
    const second = await publishCandidate({
      expectedCandidateHash: state.draft!.candidateHash,
      principalId: who,
    })

    // A run that started before the rollback has already selected.
    const inFlight = await selectRunBehaviour()
    expect(inFlight.snapshotId).toBe(second.snapshotId)

    const restored = await rollbackToRelease({
      releaseId: first.id,
      expectedLiveReleaseId: second.id,
      principalId: who,
    })

    expect(restored.origin).toBe('rollback')
    expect(restored.restoredFromId).toBe(first.id)
    expect(restored.releaseNumber).toBe(3)
    expect(restored.snapshotId).toBe(first.snapshotId)

    const next = await selectRunBehaviour()
    expect(next.snapshotId).toBe(first.snapshotId)
    expect(next.config?.agents.agent.voice.tone).not.toBe('professional')
    // The in-flight run's selection is a value it already holds; nothing here
    // rewrote it.
    expect(inFlight.snapshotId).toBe(second.snapshotId)
    expect(inFlight.config?.agents.agent.voice.tone).toBe('professional')
  })

  it('refuses a rollback when the live release moved in another session', async () => {
    const who = await reviewer()
    await setReleaseManagement(true, who)
    const first = (await getReleaseState()).live!
    await editVoice('professional')
    const state = await getReleaseState()
    await passRequiredChecks(state.draft!.id, state.draft!.candidateHash)
    await publishCandidate({
      expectedCandidateHash: state.draft!.candidateHash,
      principalId: who,
    })

    await expect(
      rollbackToRelease({
        releaseId: first.id,
        // What the reviewer's page still believed was live.
        expectedLiveReleaseId: first.id,
        principalId: who,
      })
    ).rejects.toMatchObject({ code: 'ASSISTANT_RELEASE_LIVE_CONFLICT' })
  })

  it('keeps the settings revision and managed-field semantics under release management', async () => {
    const who = await reviewer()
    await setReleaseManagement(true, who)

    const current = await getAssistantSettings()
    // A stale revision is still refused, exactly as before releases existed.
    await expect(
      updateAssistantVoice(
        current.revision - 1,
        { ...current.config.agents.agent.voice, tone: 'professional' },
        actor
      )
    ).rejects.toMatchObject({ code: 'ASSISTANT_CONFIG_REVISION_CONFLICT' })

    const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    await testDb
      .update(settings)
      .set({ managedFieldPaths: ['assistant.agents.agent.voice.tone'] })
      .where(eq(settings.id, row.id))
    const managed = await getAssistantSettings()
    await expect(
      updateAssistantVoice(
        managed.revision,
        { ...managed.config.agents.agent.voice, tone: 'professional' },
        actor
      )
    ).rejects.toMatchObject({ code: 'MANAGED_SETTING' })
  })

  it('makes the settings row live again when release management is turned off', async () => {
    const who = await reviewer()
    await setReleaseManagement(true, who)
    await editVoice('professional')
    expect((await getAssistantRuntimeConfig()).config.agents.agent.voice.tone).not.toBe(
      'professional'
    )

    await setReleaseManagement(false, who)

    const runtime = await getAssistantRuntimeConfig()
    expect(runtime.config.agents.agent.voice.tone).toBe('professional')
    expect(runtime.releaseId).toBeUndefined()
    const behaviour = await selectRunBehaviour()
    expect(behaviour.releaseId).toBeNull()
    expect(behaviour.config).toBeNull()
  })

  it('builds a fresh snapshot for a run when no release is selected', async () => {
    const behaviour = await selectRunBehaviour()
    expect(behaviour.releaseId).toBeNull()
    expect(behaviour.snapshotId).toBeTruthy()
    expect(behaviour.config).toBeNull()
  })
})
