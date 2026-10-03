import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  sql,
  settings,
  principal,
  user,
  roles,
  principalRoleAssignments,
  assistantPendingActions,
  auditLog,
} from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import type { Actor } from '@/lib/server/policy/types'
import { ALL_PERMISSIONS, PERMISSIONS } from '@/lib/shared/permissions'
import type { WebsiteBranding } from '@/lib/server/content/website-branding'
import { assertPendingWorkspaceParent } from '@/lib/server/domains/assistant/pending-action-parent'
import {
  ensureAutomaticWebsiteBranding,
  getAutomaticWebsiteBrandingStatus,
  undoAutomaticWebsiteBranding,
} from '../automatic-website-branding.service'

const seams = vi.hoisted(() => ({
  fetch: vi.fn(),
  objects: new Map<string, string>(),
  failAudit: false,
}))
vi.mock('@/lib/server/content/website-branding', () => ({ fetchWebsiteBranding: seams.fetch }))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/storage/s3', async (original) => ({
  ...(await original<typeof import('@/lib/server/storage/s3')>()),
  getPublicUrlOrNull: (key: string | null | undefined) => (key ? `/api/storage/${key}` : null),
  deleteObject: async (key: string) => {
    seams.objects.delete(key)
  },
  getS3Object: async (key: string, range?: string) => {
    const contentType = seams.objects.get(key)
    if (!contentType || range !== 'bytes=0-0') throw new Error('Unknown scoped logo')
    return {
      contentType,
      body: new ReadableStream({
        start(controller) {
          controller.close()
        },
      }),
    }
  },
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  invalidateSettingsCache: async () => undefined,
}))
vi.mock('@/lib/server/audit/log', async (original) => {
  const actual = await original<typeof import('@/lib/server/audit/log')>()
  return {
    ...actual,
    recordAuditEventInTransaction: async (
      ...args: Parameters<typeof actual.recordAuditEventInTransaction>
    ) => {
      if (seams.failAudit && args[1].event === 'branding.website.applied')
        throw new Error('Audit refused')
      return actual.recordAuditEventInTransaction(...args)
    },
  }
})
const fixture = await createDbTestFixture({
  probe: async (db) => {
    const current = getExecuteRows<{ name: string }>(
      await db.execute(sql`select current_database() as name`)
    )[0]
    if (current?.name !== 'quackback_test')
      throw new Error('Automatic branding requires quackback_test')
    await db
      .select({ key: assistantPendingActions.workspaceThreadKey })
      .from(assistantPendingActions)
      .limit(0)
  },
})
if (!fixture.available)
  throw new Error('Migrate quackback_test before running automatic branding tests')
let actor: Actor, other: Actor, settingsId: WorkspaceId
const expected: WebsiteBranding = {
  domain: 'example.com',
  logoKey: 'logos/acme.ico',
  logoUrl: '/api/storage/logos/acme.ico',
  color: '#0F766E',
}
const read = async () =>
  (await testDb.select().from(settings).where(eq(settings.id, settingsId)))[0]
const metadata = async () => JSON.parse((await read()).metadata!)
const actions = () =>
  testDb
    .select()
    .from(assistantPendingActions)
    .where(eq(assistantPendingActions.workspaceThreadKey, `website-branding:${settingsId}`))
async function person(email: string): Promise<Actor> {
  const userId = createId('user') as UserId,
    principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Acme', email })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return {
    principalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set(
      ALL_PERMISSIONS.filter((permission) => permission !== PERMISSIONS.COPILOT_USE)
    ),
  }
}
beforeEach(async () => {
  await fixture.begin()
  seams.objects.clear()
  seams.failAudit = false
  actor = await person(`you+${createId('user')}@example.com`)
  other = await person(`other+${createId('user')}@example.com`)
  const [existing] = await testDb.select().from(settings).limit(1)
  const row =
    existing ??
    (
      await testDb
        .insert(settings)
        .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
        .returning()
    )[0]
  settingsId = row.id
  await testDb
    .update(settings)
    .set({
      logoKey: null,
      brandingConfig: null,
      customCss: null,
      metadata: JSON.stringify({ sibling: 'keep' }),
      featureFlags: '{}',
      cloudIdentity: null,
    })
    .where(eq(settings.id, settingsId))
  seams.objects.set(expected.logoKey, 'image/x-icon')
  seams.fetch.mockImplementation(async (site: string) => {
    expect(site).toBe('example.com')
    return expected
  })
})
afterEach(async () => {
  await fixture.rollback()
  vi.clearAllMocks()
})
afterAll(() => fixture.close())

describe('automatic website branding (real Postgres)', () => {
  it('applies logo and both default appearances with one stored receipt and atomic audit', async () => {
    const status = await ensureAutomaticWebsiteBranding(actor)
    expect(status).toMatchObject({ domain: 'example.com', status: 'applied', canUndo: true })
    const row = await read()
    expect(row.logoKey).toBe(expected.logoKey)
    expect(JSON.parse(row.brandingConfig!)).toEqual({
      light: { primary: expected.color },
      dark: { primary: expected.color },
    })
    const [action] = await actions()
    expect(action).toMatchObject({
      toolName: 'automatic_website_branding',
      status: 'executed',
      result: { source: 'website_branding', settingsId, changes: expect.any(Array) },
    })
    expect((await metadata()).sibling).toBe('keep')
    expect(
      await testDb
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.eventType, 'branding.website.applied'), eq(auditLog.targetId, action.id))
        )
    ).toHaveLength(1)
  })
  it('lets another permitted admin Undo without Copilot or AI', async () => {
    await ensureAutomaticWebsiteBranding(actor)
    expect(await getAutomaticWebsiteBrandingStatus(other)).toMatchObject({
      status: 'applied',
      canUndo: true,
    })
    expect(await undoAutomaticWebsiteBranding(other)).toMatchObject({
      status: 'undone',
      canUndo: false,
    })
    expect((await read()).logoKey).toBeNull()
    expect((await read()).brandingConfig).toBeNull()
    expect(seams.objects.has(expected.logoKey)).toBe(true)
    expect((await metadata()).sibling).toBe('keep')
    expect((await actions())[0].result).toMatchObject({ undoneAt: expect.any(String) })
    await expect(undoAutomaticWebsiteBranding(other)).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_UNDO_UNAVAILABLE',
    })
  })
  it('applies only the logo without color authority and checks every affected Undo permission', async () => {
    const logoOnly = { ...actor, permissions: new Set([PERMISSIONS.SETTINGS_MANAGE]) }
    expect(await ensureAutomaticWebsiteBranding(logoOnly)).toMatchObject({
      status: 'applied',
      canUndo: true,
    })
    expect((await read()).brandingConfig).toBeNull()
    await undoAutomaticWebsiteBranding(logoOnly)
    await testDb.update(settings).set({ metadata: '{}' }).where(eq(settings.id, settingsId))
    await ensureAutomaticWebsiteBranding(actor)
    expect(await getAutomaticWebsiteBrandingStatus(logoOnly)).toMatchObject({
      status: 'applied',
      canUndo: false,
    })
    await expect(undoAutomaticWebsiteBranding(logoOnly)).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_PERMISSION_REQUIRED',
    })
    expect((await read()).logoKey).toBe(expected.logoKey)
  })
  it('does not claim a lookup for an administrator without a stored email', async () => {
    const [person] = await testDb
      .select()
      .from(principal)
      .where(eq(principal.id, actor.principalId!))
    await testDb.update(user).set({ email: null }).where(eq(user.id, person.userId!))
    expect(await ensureAutomaticWebsiteBranding(actor)).toBeNull()
    expect(seams.fetch).not.toHaveBeenCalled()
    expect((await metadata()).brandingLookup).toBeUndefined()
  })
  it.each(['logo', 'personal', 'attempt'] as const)(
    'does not fetch when the %s eligibility condition fails',
    async (condition) => {
      if (condition === 'logo')
        await testDb
          .update(settings)
          .set({ logoKey: 'logos/manual.png' })
          .where(eq(settings.id, settingsId))
      if (condition === 'personal')
        await testDb
          .update(user)
          .set({ email: `you+${createId('user')}@gmail.com` })
          .where(
            eq(
              user.id,
              (await testDb.select().from(principal).where(eq(principal.id, actor.principalId!)))[0]
                .userId!
            )
          )
      if (condition === 'attempt')
        await testDb
          .update(settings)
          .set({ metadata: JSON.stringify({ brandingLookup: { status: 'failed' } }) })
          .where(eq(settings.id, settingsId))
      await ensureAutomaticWebsiteBranding(actor)
      expect(seams.fetch).not.toHaveBeenCalled()
      expect(await actions()).toHaveLength(0)
    }
  )
  it('claims only once while another Home request overlaps the fetch', async () => {
    let resolve!: (value: WebsiteBranding) => void
    const pending = new Promise<WebsiteBranding>((done) => {
      resolve = done
    })
    seams.fetch.mockImplementation(async (site: string) => {
      expect(site).toBe('example.com')
      return seams.fetch.mock.calls.length === 1 ? pending : expected
    })
    const first = ensureAutomaticWebsiteBranding(actor)
    await vi.waitFor(() => expect(seams.fetch).toHaveBeenCalledOnce())
    expect(await ensureAutomaticWebsiteBranding(other)).toMatchObject({ status: 'pending' })
    expect(seams.fetch).toHaveBeenCalledOnce()
    resolve(expected)
    await first
    await ensureAutomaticWebsiteBranding(actor)
    expect(seams.fetch).toHaveBeenCalledOnce()
    expect(await actions()).toHaveLength(1)
  })
  it('records a failed fetch once and keeps Home usable', async () => {
    seams.fetch.mockImplementation(async (site: string) => {
      expect(site).toBe('example.com')
      return null
    })
    expect(await ensureAutomaticWebsiteBranding(actor)).toMatchObject({ status: 'failed' })
    await ensureAutomaticWebsiteBranding(actor)
    expect(seams.fetch).toHaveBeenCalledOnce()
    expect((await metadata()).brandingLookup.status).toBe('failed')
    expect((await read()).logoKey).toBeNull()
  })
  it('keeps a manual logo chosen during the lookup and hides stale attribution', async () => {
    seams.fetch.mockImplementation(async (site: string) => {
      expect(site).toBe('example.com')
      await testDb
        .update(settings)
        .set({ logoKey: 'logos/manual.png' })
        .where(eq(settings.id, settingsId))
      return expected
    })
    expect(await ensureAutomaticWebsiteBranding(actor)).toMatchObject({ status: 'skipped' })
    expect((await read()).logoKey).toBe('logos/manual.png')
    expect(await actions()).toHaveLength(0)
  })
  it.each(['before', 'during'] as const)(
    'preserves a manual theme chosen %s the lookup',
    async (moment) => {
      const manual = { light: { primary: '#123456' } }
      const change = () =>
        testDb
          .update(settings)
          .set({ brandingConfig: JSON.stringify(manual) })
          .where(eq(settings.id, settingsId))
      if (moment === 'before') await change()
      else
        seams.fetch.mockImplementation(async (site: string) => {
          expect(site).toBe('example.com')
          await change()
          return expected
        })
      await ensureAutomaticWebsiteBranding(actor)
      expect((await read()).logoKey).toBe(expected.logoKey)
      expect(JSON.parse((await read()).brandingConfig!)).toEqual(manual)
    }
  )
  it('preserves an explicit default theme saved during fetch', async () => {
    const defaults = {}
    seams.fetch.mockImplementation(async (site: string) => {
      expect(site).toBe('example.com')
      await testDb
        .update(settings)
        .set({ brandingConfig: JSON.stringify(defaults) })
        .where(eq(settings.id, settingsId))
      return expected
    })
    await ensureAutomaticWebsiteBranding(actor)
    expect(JSON.parse((await read()).brandingConfig!)).toEqual(defaults)
  })
  it.each([
    { stored: '{invalid', status: 'failed', logo: null },
    { stored: JSON.stringify({ futureChoice: true }), status: 'applied', logo: expected.logoKey },
  ])(
    'preserves an unrecognized stored branding configuration',
    async ({ stored, status, logo }) => {
      await testDb
        .update(settings)
        .set({ brandingConfig: stored })
        .where(eq(settings.id, settingsId))
      expect(await ensureAutomaticWebsiteBranding(actor)).toMatchObject({ status })
      expect((await read()).brandingConfig).toBe(stored)
      expect((await read()).logoKey).toBe(logo)
    }
  )
  it('does not fetch or mutate without actual settings permission', async () => {
    await ensureAutomaticWebsiteBranding({ ...actor, permissions: new Set() })
    expect(seams.fetch).not.toHaveBeenCalled()
    expect((await metadata()).brandingLookup).toBeUndefined()
  })
  it('does not trust a stale permission snapshot before the website fetch', async () => {
    const [empty] = await testDb
      .insert(roles)
      .values({ key: `none-${createId('role')}`, name: 'No settings', isSystem: false })
      .returning()
    await testDb
      .insert(principalRoleAssignments)
      .values({ principalId: actor.principalId!, roleId: empty.id })
    await ensureAutomaticWebsiteBranding(actor)
    expect(seams.fetch).not.toHaveBeenCalled()
    expect((await metadata()).brandingLookup).toBeUndefined()
  })
  it('keeps custom CSS and a color that fails contrast out of the automatic color write', async () => {
    await testDb
      .update(settings)
      .set({ customCss: ':root { --primary: #123456; }' })
      .where(eq(settings.id, settingsId))
    await ensureAutomaticWebsiteBranding(actor)
    expect((await read()).logoKey).toBe(expected.logoKey)
    expect((await read()).brandingConfig).toBeNull()
    await undoAutomaticWebsiteBranding(actor)
    await testDb
      .update(settings)
      .set({ customCss: null, metadata: '{}' })
      .where(eq(settings.id, settingsId))
    seams.fetch.mockImplementation(async (site: string) => {
      expect(site).toBe('example.com')
      return { ...expected, color: '#000000' }
    })
    await ensureAutomaticWebsiteBranding(actor)
    expect((await read()).logoKey).toBe(expected.logoKey)
    expect((await read()).brandingConfig).toBeNull()
  })
  it('rechecks permission after fetching and refuses revoked Undo', async () => {
    const [empty] = await testDb
      .insert(roles)
      .values({ key: `none-${createId('role')}`, name: 'No settings', isSystem: false })
      .returning()
    seams.fetch.mockImplementation(async (site: string) => {
      expect(site).toBe('example.com')
      await testDb
        .insert(principalRoleAssignments)
        .values({ principalId: actor.principalId!, roleId: empty.id })
      return expected
    })
    await ensureAutomaticWebsiteBranding(actor)
    expect((await read()).logoKey).toBeNull()
    expect(await actions()).toHaveLength(0)
    await testDb
      .delete(principalRoleAssignments)
      .where(eq(principalRoleAssignments.principalId, actor.principalId!))
    await testDb.update(settings).set({ metadata: '{}' }).where(eq(settings.id, settingsId))
    seams.fetch.mockImplementation(async (site: string) => {
      expect(site).toBe('example.com')
      return expected
    })
    await ensureAutomaticWebsiteBranding(actor)
    await testDb
      .insert(principalRoleAssignments)
      .values({ principalId: other.principalId!, roleId: empty.id })
    await expect(undoAutomaticWebsiteBranding(other)).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_PERMISSION_REQUIRED',
    })
    expect((await read()).logoKey).toBe(expected.logoKey)
  })
  it('refuses stale Undo without overwriting a later color and hides a replaced logo notice', async () => {
    await ensureAutomaticWebsiteBranding(actor)
    await testDb
      .update(settings)
      .set({
        brandingConfig: JSON.stringify({
          light: { primary: '#123456' },
          dark: { primary: expected.color },
        }),
      })
      .where(eq(settings.id, settingsId))
    await expect(undoAutomaticWebsiteBranding(other)).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_UNDO_CONFLICT',
    })
    expect(JSON.parse((await read()).brandingConfig!).light.primary).toBe('#123456')
    await testDb
      .update(settings)
      .set({ logoKey: 'logos/manual.png' })
      .where(eq(settings.id, settingsId))
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toBeNull()
    expect((await metadata()).brandingLookup.status).toBe('applied')
  })
  it('rejects generic pending access to the automatic row', async () => {
    await ensureAutomaticWebsiteBranding(actor)
    const [action] = await actions()
    await expect(
      assertPendingWorkspaceParent(action, { ...actor, permissions: new Set(ALL_PERMISSIONS) })
    ).rejects.toMatchObject({ code: 'PENDING_ACTION_NOT_FOUND' })
  })
  it.each([
    'source',
    'toolName',
    'settingsId',
    'claimId',
    'domain',
    'threadKey',
    'pointer',
  ] as const)('rejects an automatic receipt with a mismatched %s', async (field) => {
    await ensureAutomaticWebsiteBranding(actor)
    const [action] = await actions()
    if (field === 'source' || field === 'settingsId' || field === 'claimId' || field === 'domain') {
      const replacement = field === 'claimId' ? '00000000-0000-4000-8000-000000000000' : 'other'
      await testDb
        .update(assistantPendingActions)
        .set({ result: { ...action.result, [field]: replacement } })
        .where(eq(assistantPendingActions.id, action.id))
    } else if (field === 'toolName') {
      await testDb
        .update(assistantPendingActions)
        .set({ toolName: 'propose_settings_change' })
        .where(eq(assistantPendingActions.id, action.id))
    } else if (field === 'threadKey') {
      await testDb
        .update(assistantPendingActions)
        .set({ workspaceThreadKey: 'workspace:other' })
        .where(eq(assistantPendingActions.id, action.id))
    } else {
      const existing = await metadata()
      await testDb
        .update(settings)
        .set({
          metadata: JSON.stringify({
            ...existing,
            brandingLookup: {
              ...existing.brandingLookup,
              pendingActionId: createId('assistant_action'),
            },
          }),
        })
        .where(eq(settings.id, settingsId))
    }
    await expect(undoAutomaticWebsiteBranding(actor)).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_UNDO_UNAVAILABLE',
    })
    expect((await read()).logoKey).toBe(expected.logoKey)
  })
  it('rolls back applied settings and receipt when the atomic audit fails', async () => {
    seams.failAudit = true
    await ensureAutomaticWebsiteBranding(actor)
    expect((await read()).logoKey).toBeNull()
    expect((await read()).brandingConfig).toBeNull()
    expect(await actions()).toHaveLength(0)
    expect((await metadata()).brandingLookup.status).toBe('failed')
  })
})
