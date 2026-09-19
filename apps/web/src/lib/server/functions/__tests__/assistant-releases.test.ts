/**
 * The release server functions: who may call them, and what they hand down.
 *
 * The authorization cases are the point. A release control that a stale client
 * still submits has to be refused by the server, not merely hidden, and
 * publication and rollback each have to carry the version the reviewer saw
 * rather than re-reading whatever is current.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let schema: { parse: (value: unknown) => unknown } | null = null
    let handler: ((args: { data: never }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!handler) throw new Error('handler not registered')
      return handler({ data: (schema ? schema.parse(args?.data) : args?.data) as never })
    }
    fn.validator = (nextSchema: { parse: (value: unknown) => unknown }) => {
      schema = nextSchema
      return fn
    }
    fn.handler = (nextHandler: (args: { data: never }) => Promise<unknown>) => {
      handler = nextHandler
      return fn
    }
    return fn
  },
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => new Headers() }))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getReleaseState: vi.fn(),
  ensureDraftCandidate: vi.fn(),
  recordReleaseCheckResult: vi.fn(),
  publishCandidate: vi.fn(),
  rollbackToRelease: vi.fn(),
  setReleaseManagement: vi.fn(),
  candidateBehaviour: vi.fn(),
  liveBehaviour: vi.fn(),
  runReleaseCheck: vi.fn(),
  runCandidateSandboxTurn: vi.fn(),
  recordAuditEvent: vi.fn(),
  isAssistantConfigured: vi.fn(() => true),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/assistant/assistant-release.service', () => ({
  RELEASE_NOTE_MAX_CHARS: 500,
  getReleaseState: hoisted.getReleaseState,
  ensureDraftCandidate: hoisted.ensureDraftCandidate,
  recordReleaseCheckResult: hoisted.recordReleaseCheckResult,
  candidateBehaviour: hoisted.candidateBehaviour,
  liveBehaviour: hoisted.liveBehaviour,
}))
vi.mock('@/lib/server/domains/assistant/assistant-release.publish', () => ({
  publishCandidate: hoisted.publishCandidate,
  rollbackToRelease: hoisted.rollbackToRelease,
  setReleaseManagement: hoisted.setReleaseManagement,
}))
vi.mock('@/lib/server/domains/assistant/release-checks', () => ({
  runReleaseCheck: hoisted.runReleaseCheck,
  runCandidateSandboxTurn: hoisted.runCandidateSandboxTurn,
}))
vi.mock('@/lib/server/domains/assistant/assistant.runtime', () => ({
  isAssistantConfigured: hoisted.isAssistantConfigured,
}))
vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: hoisted.recordAuditEvent,
  actorFromAuth: () => ({ email: 'admin@example.com' }),
}))

import {
  getAssistantReleaseStateFn,
  publishAssistantReleaseFn,
  rollbackAssistantReleaseFn,
  runAssistantCandidateSandboxFn,
  runAssistantReleaseCheckFn,
  setAssistantReleaseManagementFn,
} from '../assistant-releases'

const DRAFT = {
  id: 'assistant_release_draft',
  candidateHash: 'hash-candidate',
  configRevision: 3,
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
  hoisted.getReleaseState.mockResolvedValue({ managementEnabled: true })
  hoisted.ensureDraftCandidate.mockResolvedValue(DRAFT)
  hoisted.candidateBehaviour.mockResolvedValue({ config: {}, configRevision: 3 })
  hoisted.liveBehaviour.mockResolvedValue({ config: {}, configRevision: 2 })
  hoisted.runReleaseCheck.mockResolvedValue({ status: 'passed', summary: 'ok', detail: {} })
  hoisted.publishCandidate.mockResolvedValue({ id: 'assistant_release_2', releaseNumber: 2 })
  hoisted.rollbackToRelease.mockResolvedValue({ id: 'assistant_release_3', releaseNumber: 3 })
  hoisted.runCandidateSandboxTurn.mockResolvedValue({ status: 'answered', text: 'hi' })
  hoisted.isAssistantConfigured.mockReturnValue(true)
})

describe('authorization', () => {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ['read release state', () => getAssistantReleaseStateFn()],
    ['run a check', () => runAssistantReleaseCheckFn({ data: { checkKey: 'configuration' } })],
    [
      'publish',
      () => publishAssistantReleaseFn({ data: { expectedCandidateHash: 'hash-candidate' } }),
    ],
    [
      'roll back',
      () =>
        rollbackAssistantReleaseFn({
          data: { releaseId: 'assistant_release_1', expectedLiveReleaseId: 'assistant_release_2' },
        }),
    ],
    ['change the setting', () => setAssistantReleaseManagementFn({ data: { enabled: true } })],
    [
      'run the sandbox',
      () =>
        runAssistantCandidateSandboxFn({
          data: { messages: [{ sender: 'customer', content: 'hi' }], target: 'candidate' },
        }),
    ],
  ]

  it.each(calls)('gates %s on assistant.manage', async (_name, call) => {
    await call()
    expect(hoisted.requireAuth).toHaveBeenCalledWith({
      permission: PERMISSIONS.ASSISTANT_MANAGE,
    })
  })

  it.each(calls)('refuses %s when the permission was revoked', async (_name, call) => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(call()).rejects.toThrow('Access denied')
    expect(hoisted.publishCandidate).not.toHaveBeenCalled()
    expect(hoisted.rollbackToRelease).not.toHaveBeenCalled()
    expect(hoisted.setReleaseManagement).not.toHaveBeenCalled()
    expect(hoisted.runCandidateSandboxTurn).not.toHaveBeenCalled()
    expect(hoisted.recordReleaseCheckResult).not.toHaveBeenCalled()
  })
})

describe('runAssistantReleaseCheckFn', () => {
  it('binds the stored result to the candidate it ran against', async () => {
    await runAssistantReleaseCheckFn({ data: { checkKey: 'toolset' } })
    expect(hoisted.runReleaseCheck).toHaveBeenCalledWith(
      'toolset',
      await hoisted.candidateBehaviour.mock.results[0].value
    )
    expect(hoisted.recordReleaseCheckResult).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseId: DRAFT.id,
        checkKey: 'toolset',
        status: 'passed',
        candidateHash: DRAFT.candidateHash,
        ranById: 'principal_admin',
      })
    )
  })

  it('rejects a check key that is not in the catalogue', async () => {
    await expect(
      runAssistantReleaseCheckFn({ data: { checkKey: 'made_up' as never } })
    ).rejects.toBeDefined()
    expect(hoisted.runReleaseCheck).not.toHaveBeenCalled()
  })
})

describe('publishAssistantReleaseFn', () => {
  it('passes the reviewed candidate hash through rather than re-reading one', async () => {
    await publishAssistantReleaseFn({
      data: { expectedCandidateHash: 'hash-reviewed', note: 'Warmer replies' },
    })
    expect(hoisted.publishCandidate).toHaveBeenCalledWith({
      expectedCandidateHash: 'hash-reviewed',
      note: 'Warmer replies',
      principalId: 'principal_admin',
    })
    expect(hoisted.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'assistant.release.published' })
    )
  })

  it('records no audit event when the publication was refused', async () => {
    hoisted.publishCandidate.mockRejectedValue(new Error('conflict'))
    await expect(
      publishAssistantReleaseFn({ data: { expectedCandidateHash: 'hash-reviewed' } })
    ).rejects.toThrow('conflict')
    expect(hoisted.recordAuditEvent).not.toHaveBeenCalled()
  })
})

describe('rollbackAssistantReleaseFn', () => {
  it('carries the live release the reviewer saw', async () => {
    await rollbackAssistantReleaseFn({
      data: { releaseId: 'assistant_release_1', expectedLiveReleaseId: 'assistant_release_2' },
    })
    expect(hoisted.rollbackToRelease).toHaveBeenCalledWith({
      releaseId: 'assistant_release_1',
      expectedLiveReleaseId: 'assistant_release_2',
      principalId: 'principal_admin',
    })
  })
})

describe('runAssistantCandidateSandboxFn', () => {
  it('runs the candidate behaviour by default', async () => {
    await runAssistantCandidateSandboxFn({
      data: { messages: [{ sender: 'customer', content: 'hi' }], target: 'candidate' },
    })
    expect(hoisted.candidateBehaviour).toHaveBeenCalled()
    expect(hoisted.liveBehaviour).not.toHaveBeenCalled()
  })

  it('runs the live behaviour when that is what was asked for', async () => {
    await runAssistantCandidateSandboxFn({
      data: { messages: [{ sender: 'customer', content: 'hi' }], target: 'live' },
    })
    expect(hoisted.liveBehaviour).toHaveBeenCalled()
    expect(hoisted.candidateBehaviour).not.toHaveBeenCalled()
  })

  it('refuses a thread longer than the sandbox bound', async () => {
    const messages = Array.from({ length: 21 }, () => ({
      sender: 'customer' as const,
      content: 'hi',
    }))
    await expect(
      runAssistantCandidateSandboxFn({ data: { messages, target: 'candidate' } })
    ).rejects.toBeDefined()
    expect(hoisted.runCandidateSandboxTurn).not.toHaveBeenCalled()
  })
})
