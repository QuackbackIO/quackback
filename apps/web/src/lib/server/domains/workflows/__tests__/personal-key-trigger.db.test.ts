/**
 * A change made with a personal API key counts as the teammate who owns the
 * key, so it starts workflows exactly like the same change in the app. A
 * workspace key, a personal key made before the personal-key cutoff, and every
 * other service principal (a workflow's own actions, the assistant, the
 * system) stay automated and start nothing, so a workflow's own close can
 * never trigger it again.
 *
 * Real DB (rolled back) for the key lookup; the dispatcher and engine are
 * mocked so this pins the actor type each event hands the dispatcher, whose
 * gate (`actorType === 'service'` starts nothing) has its own tests.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { apiKeys, principal, user, sql } from '@/lib/server/db'
import type { EventData } from '@/lib/server/events/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { dispatchWorkflowTrigger, interruptWaitingRuns, resumeWorkflowRun } = vi.hoisted(() => ({
  dispatchWorkflowTrigger: vi.fn(),
  interruptWaitingRuns: vi.fn(),
  resumeWorkflowRun: vi.fn(),
}))
vi.mock('../dispatcher', () => ({ dispatchWorkflowTrigger }))
vi.mock('../workflow.engine', () => ({ interruptWaitingRuns, resumeWorkflowRun }))
vi.mock('../workflow-run-events', () => ({ logRunEvent: vi.fn() }))
vi.mock('../dispatcher.guards', () => ({
  findWaitingCustomerFacingRun: vi.fn(async () => null),
  readMessageBlockReply: vi.fn(async () => null),
}))

import { dispatchWorkflowsForEvent } from '../event-trigger'
import { PERSONAL_KEY_REPLY_CUTOFF_KEY } from '@/lib/server/messages/reply-rule'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: apiKeys.id }).from(apiKeys).limit(0)
  },
})
afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedTeammate(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `U-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

/** An API key and its service principal, as key creation writes them. */
async function seedKey(
  kind: 'personal' | 'workspace',
  opts: { madeBeforeCutoff?: boolean } = {}
): Promise<PrincipalId> {
  const creator = await seedTeammate()
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(principal)
    .values({ id: principalId, role: 'member', type: 'service', createdAt: new Date() })
  await testDb.insert(apiKeys).values({
    name: `${kind} key`,
    keyHash: `${suffix()}${'0'.repeat(64)}`.slice(0, 64),
    keyPrefix: 'qb_test',
    createdById: kind === 'personal' ? creator : null,
    principalId,
    kind,
    ...(opts.madeBeforeCutoff ? { createdAt: new Date('2020-01-01T00:00:00Z') } : {}),
  })
  return principalId
}

/** A service principal that is no API key (a workflow, the assistant, an integration). */
async function seedServicePrincipal(): Promise<PrincipalId> {
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(principal)
    .values({ id: principalId, role: 'admin', type: 'service', createdAt: new Date() })
  return principalId
}

/** The `conversation.status_changed` a close emits, as the outbox hands it on. */
function closed(actor: EventData['actor']): EventData {
  return {
    id: createId('event'),
    type: 'conversation.status_changed',
    timestamp: new Date().toISOString(),
    actor,
    data: {
      conversation: {
        id: 'conversation_01kpkeytest0000000000000000',
        status: 'closed',
        channel: 'email',
        priority: 'medium',
        assignedTeamId: null,
      },
      previousStatus: 'open',
      newStatus: 'closed',
    },
  } as unknown as EventData
}

/** The actor type the dispatcher was handed, or null when nothing was dispatched. */
async function actorTypeDispatchedFor(actor: EventData['actor']): Promise<string | null> {
  dispatchWorkflowTrigger.mockClear()
  await dispatchWorkflowsForEvent(closed(actor))
  const call = dispatchWorkflowTrigger.mock.calls[0]
  return call ? (call[0] as { actorType: string }).actorType : null
}

describe.skipIf(!fixture.available)('workflow triggers from API key changes', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.clearAllMocks()
  })
  afterEach(fixture.rollback)

  it('a close made with a personal key counts as its teammate and starts workflows', async () => {
    const key = await seedKey('personal')
    expect(await actorTypeDispatchedFor({ type: 'service', principalId: key })).toBe('user')
  })

  it('a close made with a workspace key stays automated', async () => {
    const key = await seedKey('workspace')
    expect(await actorTypeDispatchedFor({ type: 'service', principalId: key })).toBe('service')
  })

  it('a personal key made before the cutoff stays automated', async () => {
    const key = await seedKey('personal', { madeBeforeCutoff: true })
    expect(await actorTypeDispatchedFor({ type: 'service', principalId: key })).toBe('service')
  })

  it('with no cutoff recorded every key stays automated', async () => {
    const key = await seedKey('personal')
    await testDb.execute(sql`DELETE FROM kv_store WHERE key = ${PERSONAL_KEY_REPLY_CUTOFF_KEY}`)
    expect(await actorTypeDispatchedFor({ type: 'service', principalId: key })).toBe('service')
  })

  it("a workflow's own close never counts as a person, so it cannot retrigger", async () => {
    // A workflow runs as a bounded service actor with no principal; the
    // assistant and integrations run as service principals that are no key.
    expect(await actorTypeDispatchedFor({ type: 'service' })).toBe('service')
    const bot = await seedServicePrincipal()
    expect(await actorTypeDispatchedFor({ type: 'service', principalId: bot })).toBe('service')
  })

  it('a teammate close in the app is unchanged', async () => {
    const teammate = await seedTeammate()
    expect(await actorTypeDispatchedFor({ type: 'user', principalId: teammate })).toBe('user')
  })

  it('a personal key close ends a parked assistant wait as resolved, like the app', async () => {
    const { findWaitingCustomerFacingRun } = await import('../dispatcher.guards')
    vi.mocked(findWaitingCustomerFacingRun).mockResolvedValue({
      id: 'workflow_run_assistant',
      cursor: { waitKind: 'assistant' },
    } as never)
    const outcomeFor = async (key: PrincipalId) => {
      resumeWorkflowRun.mockClear()
      await dispatchWorkflowsForEvent(closed({ type: 'service', principalId: key }))
      return (resumeWorkflowRun.mock.calls[0][1] as { assistantOutcome: string }).assistantOutcome
    }
    expect(await outcomeFor(await seedKey('personal'))).toBe('resolved')
    expect(await outcomeFor(await seedKey('workspace'))).toBe('escalated')
  })
})
