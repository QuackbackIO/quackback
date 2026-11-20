/**
 * Every mutation of a counted resource drops the cached plan limits inputs,
 * so the Plan limits page shows a fix (or a new excess) at once. Each case
 * primes the inputs cache, runs the real service against a real database,
 * and checks the entry is gone; a service that forgot to drop it leaves the
 * stale entry in place.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type WorkflowId, type WebhookId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { CACHE_KEYS } from '@/lib/server/cache'
import { emailSendingDomains, eq, user, principal, webhooks } from '@/lib/server/db'
import { ALL_PERMISSIONS } from '@/lib/shared/permissions'

const spies = vi.hoisted(() => ({ cache: new Map<string, unknown>() }))

vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: async (key: string) =>
    spies.cache.has(key) ? structuredClone(spies.cache.get(key)) : null,
  cacheSet: async (key: string, value: unknown) => {
    spies.cache.set(key, structuredClone(value))
  },
  cacheDel: async (...keys: string[]) => {
    for (const key of keys) spies.cache.delete(key)
  },
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/audit/log', () => ({ recordAuditEvent: vi.fn(), actorFromAuth: vi.fn() }))

import { createBoard, deleteBoard } from '@/lib/server/domains/boards/board.service'
import {
  createStatusComponent,
  createStatusComponentGroup,
  deleteStatusComponent,
  deleteStatusComponentGroup,
  reorderStatusComponentGroups,
  reorderStatusComponents,
} from '@/lib/server/domains/status/status.components'
import {
  createSendingDomain,
  deleteSendingDomain,
} from '@/lib/server/domains/channel-accounts/channel-account.service'
import { deleteWebhook, updateWebhook } from '@/lib/server/domains/webhooks/webhook.service'
import {
  setWorkflowStatus,
  softDeleteWorkflow,
} from '@/lib/server/domains/workflows/workflow.service'
import { createRole, deleteRole, updateRole } from '@/lib/server/domains/roles/role.service'
import {
  createPrincipal,
  setPrincipalRole,
} from '@/lib/server/domains/principals/principal.factory'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import {
  addOwner,
  addSendingDomain,
  addStatusComponent,
  ensureSettings,
} from './plan-limits.db-seed'

const fixture = await createDbTestFixture()
afterAll(fixture.close)

const KEY = CACHE_KEYS.PLAN_LIMITS_INPUTS
const prime = () => spies.cache.set(KEY, { usage: { maxBoards: 0 } })
const editor = (principalId: PrincipalId) => ({ principalId, permissions: ALL_PERMISSIONS })

async function addPerson(role: 'user' | 'member'): Promise<PrincipalId> {
  const uid = createId('user')
  const id = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: uid, name: 'Acme Person', email: `${uid}@example.com` })
  await testDb
    .insert(principal)
    .values({ id, userId: uid, role, type: 'user', createdAt: new Date() })
  return id
}

describe.skipIf(!fixture.available)('plan limits inputs invalidation (real DB)', () => {
  let ownerId: PrincipalId

  beforeEach(async () => {
    await fixture.begin()
    spies.cache.clear()
    await ensureSettings()
    ownerId = await addOwner()
  })
  afterEach(() => fixture.rollback())

  async function expectDropped(change: () => Promise<unknown>) {
    prime()
    await change()
    expect(spies.cache.has(KEY)).toBe(false)
  }

  it('drops on a board created or deleted', async () => {
    let id = ''
    await expectDropped(async () => {
      id = (await createBoard({ name: `Acme ${createId('board')}` })).id
    })
    await expectDropped(() => deleteBoard(id as never))
  })

  it('drops on a status component created, deleted or reordered', async () => {
    const other = await addStatusComponent('Acme Web', 5)
    let id = ''
    await expectDropped(async () => {
      id = (await createStatusComponent({ name: 'Acme API' })).id
    })
    await expectDropped(() => reorderStatusComponents([id, other] as never))
    await expectDropped(() => deleteStatusComponent(id as never))
  })

  it('drops on a status group reordered or deleted, which moves or hides its components', async () => {
    const group = await createStatusComponentGroup({ name: 'Acme group' })
    const other = await createStatusComponentGroup({ name: 'Acme other' })
    await expectDropped(() => reorderStatusComponentGroups([other.id, group.id]))
    await expectDropped(() => deleteStatusComponentGroup(group.id))
  })

  it('drops on a sending domain added or removed', async () => {
    const existing = await addSendingDomain('a.example.com', 'verified', new Date('2026-01-01'))
    const [row] = await testDb
      .select({ team: emailSendingDomains.owningTeamId })
      .from(emailSendingDomains)
      .where(eq(emailSendingDomains.id, existing as never))
    await expectDropped(() =>
      createSendingDomain({ owningTeamId: row!.team, domain: `${createId('user')}.example.com` })
    )
    await expectDropped(() => deleteSendingDomain(existing as never))
  })

  it('drops on a webhook switched off or deleted', async () => {
    const [hook] = await testDb
      .insert(webhooks)
      .values({
        url: 'https://example.com/hook',
        secret: 'acme-secret',
        events: ['post.created'],
        createdById: ownerId,
      } as never)
      .returning({ id: webhooks.id })
    await expectDropped(() => updateWebhook(hook!.id as WebhookId, { status: 'disabled' }))
    await expectDropped(() => deleteWebhook(hook!.id as WebhookId))
  })

  it('drops on a workflow paused or deleted', async () => {
    const id = createId('workflow') as WorkflowId
    await expectDropped(() => setWorkflowStatus(id, 'paused'))
    await expectDropped(() => softDeleteWorkflow(id))
  })

  it('drops on a custom role created, edited or deleted', async () => {
    let roleId = ''
    await expectDropped(async () => {
      roleId = (await createRole({ name: `Acme ${createId('user')}` }, editor(ownerId))).role.id
    })
    await expectDropped(() =>
      updateRole(roleId as never, { name: `Acme ${createId('user')}` }, editor(ownerId))
    )
    await expectDropped(() => deleteRole(roleId as never, {}, editor(ownerId)))
  })

  it("drops on a new seat and on a person's role change", async () => {
    await expectDropped(async () => {
      const uid = createId('user')
      await testDb.insert(user).values({ id: uid, name: 'Acme New', email: `${uid}@example.com` })
      await createPrincipal({ userId: uid, role: 'member' } as never)
    })
    const person = await addPerson('user')
    await expectDropped(() => setPrincipalRole({ principalId: person }, 'member'))
  })

  it('drops on any settings write', async () => {
    await expectDropped(() => invalidateSettingsCache())
  })
})
