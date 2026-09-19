/**
 * Release review, publication and the candidate sandbox (QUINN-PRODUCT P7).
 *
 * Every function gates on `assistant.manage`, like every other Quinn write.
 * Publication and rollback each carry the version the reviewer saw and are
 * refused when it has moved, so a control that was rendered a minute ago cannot
 * grant an authority the server has since withdrawn.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { AssistantReleaseId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { recordAuditEvent, actorFromAuth } from '@/lib/server/audit/log'
import { RELEASE_CHECKS, type ReleaseCheckKey } from '@/lib/shared/assistant/release'
import { RELEASE_NOTE_MAX_CHARS } from '@/lib/server/domains/assistant/assistant-release.service'
import { requireAuth } from './auth-helpers'

const log = logger.child({ component: 'assistant-releases' })

const checkKeys = RELEASE_CHECKS.map((check) => check.key) as [
  ReleaseCheckKey,
  ...ReleaseCheckKey[],
]

const runCheckSchema = z.object({ checkKey: z.enum(checkKeys) })

const publishSchema = z.object({
  expectedCandidateHash: z.string().min(1),
  note: z.string().max(RELEASE_NOTE_MAX_CHARS).optional(),
})

const rollbackSchema = z.object({
  releaseId: z.string().min(1),
  expectedLiveReleaseId: z.string().min(1).nullable(),
})

const managementSchema = z.object({ enabled: z.boolean() })

/** A sandbox thread is a handful of turns a person typed, not a transcript. */
const SANDBOX_MAX_MESSAGES = 20
const SANDBOX_MAX_CHARS = 4000

const sandboxSchema = z.object({
  messages: z
    .array(
      z.object({
        sender: z.enum(['customer', 'assistant']),
        content: z.string().min(1).max(SANDBOX_MAX_CHARS),
      })
    )
    .min(1)
    .max(SANDBOX_MAX_MESSAGES),
  /** Which behaviour to run against: the reviewed candidate or what is live now. */
  target: z.enum(['candidate', 'live']).default('candidate'),
})

export const getAssistantReleaseStateFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('read release state')
  await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
  const { getReleaseState } =
    await import('@/lib/server/domains/assistant/assistant-release.service')
  const { isAssistantConfigured } = await import('@/lib/server/domains/assistant/assistant.runtime')
  return {
    ...(await getReleaseState()),
    catalogue: RELEASE_CHECKS,
    configured: isAssistantConfigured(),
  }
})

export const runAssistantReleaseCheckFn = createServerFn({ method: 'POST' })
  .validator(runCheckSchema)
  .handler(async ({ data }) => {
    log.info({ check: data.checkKey }, 'run release check')
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { ensureDraftCandidate, getReleaseState, recordReleaseCheckResult } =
      await import('@/lib/server/domains/assistant/assistant-release.service')
    const { runReleaseCheck } = await import('@/lib/server/domains/assistant/release-checks')
    const { candidateBehaviour } =
      await import('@/lib/server/domains/assistant/assistant-release.behaviour')

    const draft = await ensureDraftCandidate(ctx.principal.id)
    const outcome = await runReleaseCheck(data.checkKey, await candidateBehaviour(draft))
    await recordReleaseCheckResult({
      releaseId: draft.id,
      checkKey: data.checkKey,
      status: outcome.status,
      // Bound to the candidate this ran against, so an edit afterwards makes it
      // stale rather than making it a lie.
      candidateHash: draft.candidateHash,
      summary: outcome.summary,
      detail: outcome.detail,
      ranById: ctx.principal.id,
    })
    return getReleaseState()
  })

export const publishAssistantReleaseFn = createServerFn({ method: 'POST' })
  .validator(publishSchema)
  .handler(async ({ data }) => {
    log.info('publish Quinn release')
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { publishCandidate } =
      await import('@/lib/server/domains/assistant/assistant-release.publish')
    const published = await publishCandidate({
      expectedCandidateHash: data.expectedCandidateHash,
      note: data.note ?? null,
      principalId: ctx.principal.id,
    })
    await recordAuditEvent({
      event: 'assistant.release.published',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'assistant_release', id: published.id },
      after: {
        releaseNumber: published.releaseNumber,
        candidateHash: published.candidateHash,
        uses: published.scope?.uses ?? [],
      },
    })
    return published
  })

export const rollbackAssistantReleaseFn = createServerFn({ method: 'POST' })
  .validator(rollbackSchema)
  .handler(async ({ data }) => {
    log.info('roll back Quinn release')
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { rollbackToRelease } =
      await import('@/lib/server/domains/assistant/assistant-release.publish')
    const restored = await rollbackToRelease({
      releaseId: data.releaseId as AssistantReleaseId,
      expectedLiveReleaseId: (data.expectedLiveReleaseId as AssistantReleaseId | null) ?? null,
      principalId: ctx.principal.id,
    })
    await recordAuditEvent({
      event: 'assistant.release.rolled_back',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'assistant_release', id: restored.id },
      after: { releaseNumber: restored.releaseNumber, restoredFromId: restored.restoredFromId },
    })
    return restored
  })

export const setAssistantReleaseManagementFn = createServerFn({ method: 'POST' })
  .validator(managementSchema)
  .handler(async ({ data }) => {
    log.info({ enabled: data.enabled }, 'set release management')
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { getReleaseState } =
      await import('@/lib/server/domains/assistant/assistant-release.service')
    const { setReleaseManagement } =
      await import('@/lib/server/domains/assistant/assistant-release.publish')
    await setReleaseManagement(data.enabled, ctx.principal.id)
    await recordAuditEvent({
      event: 'assistant.release.management_changed',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'settings' },
      after: { enabled: data.enabled },
    })
    return getReleaseState()
  })

/**
 * One sandbox turn against the candidate or against what is live.
 *
 * It grounds on no conversation, so it writes nothing to the inbox, and every
 * write tool previews instead of running. Comparing the two targets on the same
 * question is the draft/live comparison the review needs.
 */
export const runAssistantCandidateSandboxFn = createServerFn({ method: 'POST' })
  .validator(sandboxSchema)
  .handler(async ({ data }) => {
    log.info({ target: data.target }, 'run candidate sandbox turn')
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { ensureDraftCandidate } =
      await import('@/lib/server/domains/assistant/assistant-release.service')
    const { candidateBehaviour, liveBehaviour } =
      await import('@/lib/server/domains/assistant/assistant-release.behaviour')
    const { runCandidateSandboxTurn } =
      await import('@/lib/server/domains/assistant/release-checks')
    const behaviour =
      data.target === 'live'
        ? await liveBehaviour()
        : await candidateBehaviour(await ensureDraftCandidate(ctx.principal.id))
    return runCandidateSandboxTurn({ messages: data.messages, candidate: behaviour })
  })
