/**
 * An agent never publishes the portal design. Asking to publish files an
 * approval listing the draft's changes; a person who may edit branding
 * approves it, and exactly that draft goes live. A draft that moved after the
 * request is refused, so nobody approves something they were not shown.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  assistantPendingActions,
  eq,
  portalDesignRevisions,
  principal,
  settings,
  user,
} from '@/lib/server/db'
import { ALL_PERMISSIONS } from '@/lib/shared/permissions'
import { permissionsForLegacyRole } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  invalidateSettingsCache: async () => undefined,
}))
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
  cacheDel: vi.fn(async () => undefined),
}))
vi.mock('@/lib/server/local-cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/local-cache')>()),
  localCacheGet: () => undefined,
  localCacheSet: () => undefined,
}))

const { requestDesignPublish } = await import('../design-publish-request')
const { approveApproval, rejectApproval } = await import('../approvals.service')
const { getApprovalForViewer } = await import('../approvals.queue')
const design = await import('@/lib/server/domains/design/design.actions')
const { defaultDesign } = await import('@/lib/shared/design/schema')

const fixture = await createDbTestFixture()

let owner: Actor
let otherAdmin: Actor
let member: Actor

async function seedPerson(role: 'admin' | 'member'): Promise<Actor> {
  const userId = createId('user')
  const principalId = createId('principal')
  await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return {
    principalId,
    role,
    principalType: 'user',
    segmentIds: new Set(),
    permissions: role === 'admin' ? new Set(ALL_PERMISSIONS) : permissionsForLegacyRole('member'),
  }
}

const authorOf = (actor: Actor) => ({
  principalId: actor.principalId as PrincipalId,
  actor: { role: actor.role, type: 'user' as const },
})

/** An agent's key asking as its own service principal, through MCP. */
async function keyRequester() {
  const principalId = createId('principal')
  await testDb
    .insert(principal)
    .values({
      id: principalId,
      role: 'admin',
      type: 'service',
      displayName: 'Design agent',
      createdAt: new Date(),
    })
  return {
    principalId,
    requester: {
      via: 'mcp' as const,
      requestedById: principalId,
      onBehalfOfPrincipalId: owner.principalId!,
      credentialId: null,
      clientName: 'Design agent',
    },
  }
}

async function draftTeal() {
  const doc = defaultDesign()
  doc.brand.light.accent = '#0f766e'
  doc.layout.density = 'compact'
  const saved = await design.saveDesignDraft(doc, authorOf(owner))
  expect(saved.ok).toBe(true)
}

const revisions = () => testDb.select().from(portalDesignRevisions)

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  owner = await seedPerson('admin')
  otherAdmin = await seedPerson('admin')
  member = await seedPerson('member')
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${createId('workspace').slice(-8)}`,
    createdAt: new Date(),
    brandingConfig: JSON.stringify({ themeMode: 'light', light: { primary: '#7a1f35' } }),
  })
})
afterEach(() => fixture.rollback())
afterAll(() => fixture.close())

describe('requestDesignPublish', () => {
  it('refuses when there is no draft', async () => {
    const { requester } = await keyRequester()
    expect(await requestDesignPublish(requester)).toMatchObject({
      ok: false,
      code: 'NO_DRAFT',
    })
    expect(await testDb.select().from(assistantPendingActions)).toEqual([])
  })

  it('files an approval listing the draft’s changes, and publishes nothing', async () => {
    await draftTeal()
    const { requester } = await keyRequester()
    const result = await requestDesignPublish(requester)
    if (!result.ok) throw new Error(result.message)
    const row = result.request
    expect(row).toMatchObject({
      toolName: 'publish_portal_design',
      status: 'proposed',
      risk: 'medium',
      workspaceThreadKey: null,
      conversationId: null,
      requestedVia: 'mcp',
    })
    expect(row.argsDigest).toBeTruthy()
    const args = row.args as { changes: Array<{ path: string; label: string }> }
    expect(args.changes.map((change) => [change.path, change.label])).toEqual(
      expect.arrayContaining([
        ['brand.light.accent', 'Accent'],
        ['layout.density', 'Density'],
      ])
    )
    expect(row.summary).toMatch(/Publish the portal design/)
    expect(await revisions()).toEqual([])
  })

  it('returns the waiting request when asked again for the same draft', async () => {
    await draftTeal()
    const { requester } = await keyRequester()
    const first = await requestDesignPublish(requester)
    const second = await requestDesignPublish(requester)
    if (!first.ok || !second.ok) throw new Error('expected requests')
    expect(second.request.id).toBe(first.request.id)
  })
})

describe('deciding a design publish', () => {
  it('publishes exactly the requested draft when a person approves it', async () => {
    await draftTeal()
    const { requester } = await keyRequester()
    const filed = await requestDesignPublish(requester)
    if (!filed.ok) throw new Error(filed.message)

    const decided = await approveApproval(otherAdmin, filed.request.id, {
      contentHash: filed.request.argsDigest!,
    })
    expect(decided.status).toBe('executed')
    const [published] = await revisions()
    expect(published).toMatchObject({
      number: 1,
      source: 'mcp',
      message: null,
      principalId: otherAdmin.principalId,
    })
    expect(
      (published.document as { brand: { light: { accent: string } } }).brand.light.accent
    ).toBe('#0f766e')
    expect(decided.result).toMatchObject({ number: 1 })
    expect((await design.readDesignForEditing()).source).toBe('published')
  })

  it('refuses when the draft changed after the request, and publishes nothing', async () => {
    await draftTeal()
    const { requester } = await keyRequester()
    const filed = await requestDesignPublish(requester)
    if (!filed.ok) throw new Error(filed.message)
    const moved = defaultDesign()
    moved.layout.cards = 'list'
    await design.saveDesignDraft(moved, authorOf(owner))

    await expect(
      approveApproval(otherAdmin, filed.request.id, { contentHash: filed.request.argsDigest! })
    ).rejects.toMatchObject({ code: 'DRAFT_CHANGED' })
    expect(await revisions()).toEqual([])
    const [row] = await testDb
      .select()
      .from(assistantPendingActions)
      .where(eq(assistantPendingActions.id, filed.request.id))
    expect(row.status).toBe('proposed')
  })

  it('needs a person who may edit branding, never the key that asked', async () => {
    await draftTeal()
    const { principalId, requester } = await keyRequester()
    const filed = await requestDesignPublish(requester)
    if (!filed.ok) throw new Error(filed.message)
    const decision = { contentHash: filed.request.argsDigest! }

    await expect(approveApproval(member, filed.request.id, decision)).rejects.toMatchObject({
      code: 'APPROVAL_PERMISSION_REQUIRED',
    })
    const key: Actor = { ...owner, principalId, principalType: 'service' }
    await expect(approveApproval(key, filed.request.id, decision)).rejects.toMatchObject({
      code: 'APPROVAL_SELF_DECISION',
    })
    expect(await revisions()).toEqual([])
  })

  it('shows the changes on the approvals page and can be turned down', async () => {
    await draftTeal()
    const { requester } = await keyRequester()
    const filed = await requestDesignPublish(requester)
    if (!filed.ok) throw new Error(filed.message)

    const view = await getApprovalForViewer(otherAdmin, filed.request.id)
    expect(view?.diff.kind).toBe('design')
    expect(
      view?.diff.kind === 'design' && view.diff.changes.find((c) => c.path === 'layout.density')
    ).toMatchObject({ label: 'Density', before: 'comfortable', after: 'compact' })

    const rejected = await rejectApproval(otherAdmin, filed.request.id, {
      contentHash: filed.request.argsDigest!,
    })
    expect(rejected.status).toBe('rejected')
    expect(await revisions()).toEqual([])
    expect((await design.readDesignForEditing()).source).toBe('draft')
  })
})
