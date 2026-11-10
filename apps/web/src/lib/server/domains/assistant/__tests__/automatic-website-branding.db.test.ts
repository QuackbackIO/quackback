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
  portalDesigns,
} from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import type { Actor } from '@/lib/server/policy/types'
import { ALL_PERMISSIONS, PERMISSIONS } from '@/lib/shared/permissions'
import type { WebsiteBranding } from '@/lib/server/content/website-branding'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { getDesignState, publishDraft, saveDraft } from '@/lib/server/domains/design/design.service'
import { defaultDesign } from '@/lib/shared/design/schema'
import { resetConfig } from '@/lib/server/config'
import {
  acceptWebsiteBrandingOffer,
  declineWebsiteBrandingOffer,
  ensureAutomaticWebsiteBranding,
  getAutomaticWebsiteBrandingStatus,
  lookupWebsiteBrandingForSite,
  undoAutomaticWebsiteBranding,
} from '../automatic-website-branding.service'

const seams = vi.hoisted(() => ({
  fetch: vi.fn(),
  objects: new Map<string, string>(),
  failAudit: false,
  available: true,
}))
vi.mock('@/lib/server/content/website-branding', () => ({ fetchWebsiteBranding: seams.fetch }))
vi.mock('../automatic-website-branding.availability', () => ({
  automaticBrandingAvailable: () => seams.available,
}))
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
    if (!current?.name.startsWith('quackback_test'))
      throw new Error('Automatic branding requires a quackback_test database')
    await db.select({ metadata: settings.metadata }).from(settings).limit(0)
  },
})
if (!fixture.available)
  throw new Error('Migrate a quackback_test database before running automatic branding tests')
let actor: Actor, other: Actor, settingsId: WorkspaceId
const good: WebsiteBranding = {
  domain: 'example.com',
  logoKey: 'logos/acme.png',
  logoUrl: '/api/storage/logos/acme.png',
  quality: 'good',
  color: '#0F766E',
}
const weak: WebsiteBranding = {
  ...good,
  logoKey: 'logos/acme.ico',
  logoUrl: '/api/storage/logos/acme.ico',
  quality: 'weak',
}
const read = async () =>
  (await testDb.select().from(settings).where(eq(settings.id, settingsId)))[0]
const metadata = async () => JSON.parse((await read()).metadata!)
const setRow = (values: Partial<typeof settings.$inferInsert>) =>
  testDb.update(settings).set(values).where(eq(settings.id, settingsId))
const setLookup = async (patch: Record<string, unknown>) => {
  const bag = await metadata()
  await setRow({
    metadata: JSON.stringify({ ...bag, brandingLookup: { ...bag.brandingLookup, ...patch } }),
  })
}
const audits = (event: string) =>
  testDb
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.eventType, event), eq(auditLog.targetId, settingsId)))
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60_000).toISOString()
/** A workspace created and set up `days` ago: inside its launch window for 14 days. */
const launchedDaysAgo = (days: number) => ({
  createdAt: new Date(daysAgo(days)),
  setupState: JSON.stringify({
    version: 2,
    steps: { core: true, workspace: true, startingPoint: null },
    completedAt: daysAgo(days),
  }),
})
const fetchReturns = (result: WebsiteBranding | null) =>
  seams.fetch.mockImplementation(async (site: string) => {
    expect(site).toBe('example.com')
    return result
  })
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
async function revokeAll(target: Actor) {
  const [empty] = await testDb
    .insert(roles)
    .values({ key: `none-${createId('role')}`, name: 'No settings', isSystem: false })
    .returning()
  await testDb
    .insert(principalRoleAssignments)
    .values({ principalId: target.principalId!, roleId: empty.id })
}
beforeEach(async () => {
  await fixture.begin()
  invalidateTierLimitsCache()
  seams.objects.clear()
  seams.failAudit = false
  seams.available = true
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
  await setRow({
    logoKey: null,
    brandingConfig: null,
    customCss: null,
    tierLimits: null,
    metadata: JSON.stringify({ sibling: 'keep' }),
    featureFlags: '{}',
    cloudIdentity: null,
    ...launchedDaysAgo(0),
  })
  seams.objects.set(good.logoKey, 'image/png')
  seams.objects.set(weak.logoKey, 'image/x-icon')
  fetchReturns(good)
})
afterEach(async () => {
  await fixture.rollback()
  invalidateTierLimitsCache()
  vi.clearAllMocks()
})
afterAll(() => fixture.close())

/** The lookup only keeps what it finds as an offer; "Use it" is what applies it. */
async function lookUpAndUse(who: typeof actor) {
  await ensureAutomaticWebsiteBranding(who)
  return acceptWebsiteBrandingOffer(who)
}

describe('automatic website branding (real Postgres)', () => {
  it('offers a good logo without changing settings, then applies it and both default appearances on Use it, with the receipt in the lookup and an atomic audit', async () => {
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toMatchObject({
      domain: 'example.com',
      status: 'eligible',
    })
    expect(await ensureAutomaticWebsiteBranding(actor)).toEqual({
      domain: 'example.com',
      status: 'offered',
      logoUrl: '/api/storage/logos/acme.png',
      colorApplied: false,
      canUndo: false,
      canUse: true,
    })
    expect((await read()).logoKey).toBeNull()
    expect((await read()).brandingConfig).toBeNull()
    expect(await audits('branding.website.applied')).toHaveLength(0)
    expect(await acceptWebsiteBrandingOffer(actor)).toEqual({
      domain: 'example.com',
      status: 'applied',
      logoUrl: '/api/storage/logos/acme.png',
      colorApplied: true,
      canUndo: true,
      canUse: false,
    })
    const row = await read()
    expect(row.logoKey).toBe(good.logoKey)
    expect(JSON.parse(row.brandingConfig!)).toEqual({
      light: { primary: good.color },
      dark: { primary: good.color },
    })
    const bag = await metadata()
    expect(bag.sibling).toBe('keep')
    expect(bag.brandingLookup).toMatchObject({
      status: 'applied',
      offer: { logoKey: good.logoKey, color: good.color },
      receipt: { kind: 'settings', storageEffects: expect.any(Array) },
    })
    expect(await audits('branding.website.applied')).toHaveLength(1)
    expect(
      await testDb
        .select()
        .from(assistantPendingActions)
        .where(eq(assistantPendingActions.toolName, 'automatic_website_branding'))
    ).toHaveLength(0)
  })

  it('lets another permitted admin Undo without Copilot or AI, once', async () => {
    await lookUpAndUse(actor)
    expect(await getAutomaticWebsiteBrandingStatus(other)).toMatchObject({
      status: 'applied',
      canUndo: true,
    })
    expect(await undoAutomaticWebsiteBranding(other)).toMatchObject({ status: 'undone' })
    expect((await read()).logoKey).toBeNull()
    expect((await read()).brandingConfig).toBeNull()
    expect(seams.objects.has(good.logoKey)).toBe(true)
    expect((await metadata()).sibling).toBe('keep')
    expect(await audits('branding.website.undone')).toHaveLength(1)
    await expect(undoAutomaticWebsiteBranding(other)).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_UNAVAILABLE',
    })
    await ensureAutomaticWebsiteBranding(actor)
    expect(seams.fetch).toHaveBeenCalledOnce()
  })

  it('applies only the logo without color authority and checks every affected Undo permission', async () => {
    const logoOnly = { ...actor, permissions: new Set([PERMISSIONS.SETTINGS_MANAGE]) }
    expect(await lookUpAndUse(logoOnly)).toMatchObject({
      status: 'applied',
      colorApplied: false,
      canUndo: true,
    })
    expect((await read()).brandingConfig).toBeNull()
    await undoAutomaticWebsiteBranding(logoOnly)
    await setRow({ metadata: '{}' })
    await lookUpAndUse(actor)
    expect(await getAutomaticWebsiteBrandingStatus(logoOnly)).toMatchObject({
      status: 'applied',
      canUndo: false,
    })
    await expect(undoAutomaticWebsiteBranding(logoOnly)).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_PERMISSION_REQUIRED',
    })
    expect((await read()).logoKey).toBe(good.logoKey)
  })

  it('keeps the logo and skips the color when the plan has no custom colors', async () => {
    await setRow({ tierLimits: JSON.stringify({ features: { customColors: false } }) })
    expect(await lookUpAndUse(actor)).toMatchObject({
      status: 'applied',
      colorApplied: false,
    })
    expect((await read()).logoKey).toBe(good.logoKey)
    expect((await read()).brandingConfig).toBeNull()
  })

  it('offers a weak logo without changing settings, then applies it with Use it', async () => {
    fetchReturns(weak)
    expect(await ensureAutomaticWebsiteBranding(actor)).toEqual({
      domain: 'example.com',
      status: 'offered',
      logoUrl: '/api/storage/logos/acme.ico',
      colorApplied: false,
      canUndo: false,
      canUse: true,
    })
    expect((await read()).logoKey).toBeNull()
    expect((await read()).brandingConfig).toBeNull()
    expect(await audits('branding.website.applied')).toHaveLength(0)
    expect(await acceptWebsiteBrandingOffer(other)).toMatchObject({
      status: 'applied',
      colorApplied: true,
      canUndo: true,
    })
    expect((await read()).logoKey).toBe(weak.logoKey)
    expect(JSON.parse((await read()).brandingConfig!).light.primary).toBe(good.color)
    expect(await audits('branding.website.applied')).toHaveLength(1)
    await undoAutomaticWebsiteBranding(actor)
    expect((await read()).logoKey).toBeNull()
  })

  it('closes an offer with Not now and never offers it again', async () => {
    fetchReturns(weak)
    await ensureAutomaticWebsiteBranding(actor)
    expect(await declineWebsiteBrandingOffer(actor)).toMatchObject({ status: 'declined' })
    expect((await read()).logoKey).toBeNull()
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toMatchObject({ status: 'declined' })
    await expect(acceptWebsiteBrandingOffer(actor)).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_UNAVAILABLE',
    })
    await ensureAutomaticWebsiteBranding(actor)
    expect(seams.fetch).toHaveBeenCalledOnce()
  })

  it('treats a logo set by hand as the answer to an offer', async () => {
    fetchReturns(weak)
    await ensureAutomaticWebsiteBranding(actor)
    await setRow({ logoKey: 'logos/manual.png' })
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toBeNull()
    await expect(acceptWebsiteBrandingOffer(actor)).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_UNAVAILABLE',
    })
    expect((await read()).logoKey).toBe('logos/manual.png')
  })

  it('never looks up a workspace outside its launch window', async () => {
    await setRow(launchedDaysAgo(30))
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toBeNull()
    expect(await ensureAutomaticWebsiteBranding(actor)).toBeNull()
    expect(seams.fetch).not.toHaveBeenCalled()
    expect(await metadata()).toEqual({ sibling: 'keep' })
    await setRow(launchedDaysAgo(13))
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toMatchObject({ status: 'eligible' })
  })

  it('never looks up a workspace marked as existing by migration 0295', async () => {
    await setRow({
      metadata: JSON.stringify({
        brandingLookup: {
          version: 1,
          status: 'skipped',
          reason: 'existing',
          completedAt: daysAgo(0),
        },
      }),
    })
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toBeNull()
    expect(await ensureAutomaticWebsiteBranding(actor)).toBeNull()
    expect(seams.fetch).not.toHaveBeenCalled()
    expect((await read()).logoKey).toBeNull()
  })

  it('reads ineligible teammates as null, so Home never asks to start', async () => {
    const [actorPrincipal] = await testDb
      .select()
      .from(principal)
      .where(eq(principal.id, actor.principalId!))
    await testDb
      .update(user)
      .set({ email: `you+${createId('user')}@gmail.com` })
      .where(eq(user.id, actorPrincipal.userId!))
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toBeNull()
    expect(await getAutomaticWebsiteBrandingStatus({ ...actor, permissions: new Set() })).toBeNull()
    await testDb.update(user).set({ email: null }).where(eq(user.id, actorPrincipal.userId!))
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toBeNull()
    expect(await ensureAutomaticWebsiteBranding(actor)).toBeNull()
    expect(seams.fetch).not.toHaveBeenCalled()
    expect((await metadata()).brandingLookup).toBeUndefined()
    expect(await getAutomaticWebsiteBrandingStatus(other)).toMatchObject({ status: 'eligible' })
  })

  it('records a workspace that already has a logo as skipped, so a later removal never triggers a lookup', async () => {
    await setRow({ logoKey: 'logos/manual.png' })
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toMatchObject({ status: 'eligible' })
    expect(await ensureAutomaticWebsiteBranding(actor)).toMatchObject({ status: 'skipped' })
    expect(seams.fetch).not.toHaveBeenCalled()
    await setRow({ logoKey: null })
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toMatchObject({ status: 'skipped' })
    await ensureAutomaticWebsiteBranding(actor)
    expect(seams.fetch).not.toHaveBeenCalled()
  })

  it('does nothing and records nothing while the operator switch or storage stops the lookup', async () => {
    seams.available = false
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toBeNull()
    expect(await ensureAutomaticWebsiteBranding(actor)).toBeNull()
    expect(seams.fetch).not.toHaveBeenCalled()
    expect((await metadata()).brandingLookup).toBeUndefined()
  })

  it('reads a claim older than five minutes as failed instead of pending forever', async () => {
    await setRow({
      metadata: JSON.stringify({
        brandingLookup: {
          version: 1,
          status: 'pending',
          domain: 'example.com',
          claimId: '00000000-0000-4000-8000-000000000000',
          ownerPrincipalId: actor.principalId,
          startedAt: new Date(Date.now() - 60_000).toISOString(),
          completedAt: null,
        },
      }),
    })
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toMatchObject({ status: 'pending' })
    await setLookup({ startedAt: new Date(Date.now() - 6 * 60_000).toISOString() })
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toMatchObject({ status: 'failed' })
    await ensureAutomaticWebsiteBranding(actor)
    expect(seams.fetch).not.toHaveBeenCalled()
  })

  it('hides the applied notice after the notice window, but keeps an offer until a logo is set', async () => {
    await lookUpAndUse(actor)
    await setLookup({ completedAt: daysAgo(2) })
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toMatchObject({ status: 'applied' })
    await setLookup({ completedAt: daysAgo(4) })
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toBeNull()
    await undoAutomaticWebsiteBranding(actor)
    await setRow({ metadata: '{}' })
    fetchReturns(weak)
    await ensureAutomaticWebsiteBranding(actor)
    // The launch plan's branding step asks for the answer, so the offer does not expire.
    await setLookup({ completedAt: daysAgo(30) })
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toMatchObject({
      status: 'offered',
      canUse: true,
    })
    await setRow({ logoKey: 'logos/manual.png' })
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toBeNull()
  })

  it('hides the notice once any stored field changes, and refuses a stale Undo without overwriting it', async () => {
    await lookUpAndUse(actor)
    await setRow({
      brandingConfig: JSON.stringify({
        light: { primary: '#123456' },
        dark: { primary: good.color },
      }),
    })
    expect((await read()).logoKey).toBe(good.logoKey)
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toBeNull()
    await expect(undoAutomaticWebsiteBranding(other)).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_UNDO_CONFLICT',
    })
    expect(JSON.parse((await read()).brandingConfig!).light.primary).toBe('#123456')
    expect((await read()).logoKey).toBe(good.logoKey)
    expect((await metadata()).brandingLookup.status).toBe('applied')
  })

  it('records a failed fetch once and keeps Home usable', async () => {
    fetchReturns(null)
    expect(await ensureAutomaticWebsiteBranding(actor)).toMatchObject({ status: 'failed' })
    await ensureAutomaticWebsiteBranding(actor)
    expect(seams.fetch).toHaveBeenCalledOnce()
    expect((await metadata()).brandingLookup.status).toBe('failed')
    expect((await read()).logoKey).toBeNull()
  })

  it('keeps a manual logo chosen during the lookup', async () => {
    seams.fetch.mockImplementation(async (site: string) => {
      expect(site).toBe('example.com')
      await setRow({ logoKey: 'logos/manual.png' })
      return good
    })
    expect(await ensureAutomaticWebsiteBranding(actor)).toMatchObject({ status: 'skipped' })
    expect((await read()).logoKey).toBe('logos/manual.png')
  })

  it.each(['before', 'during'] as const)(
    'preserves a manual theme chosen %s the lookup',
    async (moment) => {
      const manual = { light: { primary: '#123456' } }
      const change = () => setRow({ brandingConfig: JSON.stringify(manual) })
      if (moment === 'before') await change()
      else
        seams.fetch.mockImplementation(async (site: string) => {
          expect(site).toBe('example.com')
          await change()
          return good
        })
      expect(await ensureAutomaticWebsiteBranding(actor)).toMatchObject({ status: 'offered' })
      expect(await acceptWebsiteBrandingOffer(actor)).toMatchObject({ colorApplied: false })
      expect((await read()).logoKey).toBe(good.logoKey)
      expect(JSON.parse((await read()).brandingConfig!)).toEqual(manual)
    }
  )

  it('leaves a theme saved during the fetch untouched: the lookup only offers', async () => {
    seams.fetch.mockImplementation(async (site: string) => {
      expect(site).toBe('example.com')
      await setRow({ brandingConfig: '{}' })
      return good
    })
    expect(await ensureAutomaticWebsiteBranding(actor)).toMatchObject({ status: 'offered' })
    expect(JSON.parse((await read()).brandingConfig!)).toEqual({})
    expect((await read()).logoKey).toBeNull()
  })

  it.each([
    { stored: '{invalid', applied: false, logo: null },
    { stored: JSON.stringify({ futureChoice: true }), applied: true, logo: good.logoKey },
  ])(
    'preserves an unrecognized stored branding configuration (applied: $applied)',
    async ({ stored, applied, logo }) => {
      await setRow({ brandingConfig: stored })
      expect(await ensureAutomaticWebsiteBranding(actor)).toMatchObject({ status: 'offered' })
      if (applied) {
        expect(await acceptWebsiteBrandingOffer(actor)).toMatchObject({ status: 'applied' })
      } else {
        await expect(acceptWebsiteBrandingOffer(actor)).rejects.toThrow()
      }
      expect((await read()).brandingConfig).toBe(stored)
      expect((await read()).logoKey).toBe(logo)
    }
  )

  it('does not trust a stale permission snapshot before the website fetch', async () => {
    await revokeAll(actor)
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toBeNull()
    await ensureAutomaticWebsiteBranding(actor)
    expect(seams.fetch).not.toHaveBeenCalled()
    expect((await metadata()).brandingLookup).toBeUndefined()
  })

  it('keeps custom CSS and a color that fails the gate out of the automatic color write', async () => {
    await setRow({ customCss: ':root { --primary: #123456; }' })
    await lookUpAndUse(actor)
    expect((await read()).logoKey).toBe(good.logoKey)
    expect((await read()).brandingConfig).toBeNull()
    await undoAutomaticWebsiteBranding(actor)
    await setRow({ customCss: null, metadata: '{}' })
    fetchReturns({ ...good, color: null })
    expect(await lookUpAndUse(actor)).toMatchObject({ colorApplied: false })
    expect((await read()).brandingConfig).toBeNull()
  })

  it('rechecks permission after fetching and refuses a revoked Undo', async () => {
    seams.fetch.mockImplementation(async (site: string) => {
      expect(site).toBe('example.com')
      await revokeAll(actor)
      return good
    })
    await ensureAutomaticWebsiteBranding(actor)
    expect((await read()).logoKey).toBeNull()
    expect((await metadata()).brandingLookup.status).toBe('failed')
    await testDb
      .delete(principalRoleAssignments)
      .where(eq(principalRoleAssignments.principalId, actor.principalId!))
    await setRow({ metadata: '{}' })
    fetchReturns(good)
    await lookUpAndUse(actor)
    await revokeAll(other)
    await expect(undoAutomaticWebsiteBranding(other)).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_PERMISSION_REQUIRED',
    })
    expect((await read()).logoKey).toBe(good.logoKey)
  })

  it.each([
    [
      'a change outside branding',
      { id: 'portal.displayName', area: 'portal', path: ['displayName'] },
    ],
    ['a logo other than the offered one', { after: 'logos/other.png' }],
  ])('refuses Undo and hides the notice for a receipt holding %s', async (_, tamper) => {
    await lookUpAndUse(actor)
    const bag = await metadata()
    const [first, ...rest] = bag.brandingLookup.receipt.changes
    await setLookup({
      receipt: { ...bag.brandingLookup.receipt, changes: [{ ...first, ...tamper }, ...rest] },
    })
    expect(await getAutomaticWebsiteBrandingStatus(actor)).toBeNull()
    await expect(undoAutomaticWebsiteBranding(actor)).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_UNAVAILABLE',
    })
    expect((await read()).logoKey).toBe(good.logoKey)
  })

  it('rolls back applied settings and the receipt when the atomic audit fails on Use it', async () => {
    await ensureAutomaticWebsiteBranding(actor)
    seams.failAudit = true
    await expect(acceptWebsiteBrandingOffer(actor)).rejects.toThrow()
    expect((await read()).logoKey).toBeNull()
    expect((await read()).brandingConfig).toBeNull()
    expect((await metadata()).brandingLookup.status).toBe('offered')
    expect((await metadata()).brandingLookup.receipt).toBeUndefined()
  })
})

describe("the branding step's Find logo (real Postgres)", () => {
  it('looks up a typed website for a personal email, and only offers what it finds', async () => {
    const solo = await person(`solo+${createId('user')}@gmail.com`)
    expect(await getAutomaticWebsiteBrandingStatus(solo)).toBeNull()
    seams.fetch.mockImplementation(async (site: string) => {
      expect(site).toBe('https://acme.example/')
      return good
    })
    expect(await lookupWebsiteBrandingForSite(solo, 'acme.example')).toMatchObject({
      domain: 'acme.example',
      status: 'offered',
      canUse: true,
    })
    expect((await read()).logoKey).toBeNull()
    expect(await acceptWebsiteBrandingOffer(solo)).toMatchObject({ status: 'applied' })
    expect((await read()).logoKey).toBe(good.logoKey)
  })

  it('tries again after a lookup that found nothing or was declined', async () => {
    fetchReturns(null)
    expect(await ensureAutomaticWebsiteBranding(actor)).toMatchObject({ status: 'failed' })
    seams.fetch.mockImplementation(async () => weak)
    expect(await lookupWebsiteBrandingForSite(actor, 'https://acme.example')).toMatchObject({
      status: 'offered',
    })
    expect(await declineWebsiteBrandingOffer(actor)).toMatchObject({ status: 'declined' })
    expect(await lookupWebsiteBrandingForSite(actor, 'acme.example')).toMatchObject({
      status: 'offered',
    })
  })

  it('records a typed website that has no logo as failed', async () => {
    seams.fetch.mockImplementation(async () => null)
    expect(await lookupWebsiteBrandingForSite(actor, 'acme.example')).toMatchObject({
      domain: 'acme.example',
      status: 'failed',
    })
  })

  it('refuses what it cannot fetch, a workspace that has a logo, and a second lookup at once', async () => {
    await expect(lookupWebsiteBrandingForSite(actor, 'not a site')).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_INVALID_SITE',
    })
    await expect(lookupWebsiteBrandingForSite(actor, 'ftp://acme.example')).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_INVALID_SITE',
    })
    await setLookup({
      status: 'pending',
      domain: 'acme.example',
      claimId: crypto.randomUUID(),
      ownerPrincipalId: actor.principalId,
      startedAt: new Date().toISOString(),
      completedAt: null,
      version: 1,
    })
    await expect(lookupWebsiteBrandingForSite(actor, 'acme.example')).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_BUSY',
    })
    await setRow({ logoKey: 'logos/manual.png', metadata: '{}' })
    await expect(lookupWebsiteBrandingForSite(actor, 'acme.example')).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_UNAVAILABLE',
    })
    expect(seams.fetch).not.toHaveBeenCalled()
  })

  it('needs the right to change settings', async () => {
    await revokeAll(actor)
    await expect(lookupWebsiteBrandingForSite(actor, 'acme.example')).rejects.toMatchObject({
      code: 'WEBSITE_BRANDING_PERMISSION_REQUIRED',
    })
    expect(seams.fetch).not.toHaveBeenCalled()
  })
})

describe('automatic website branding on the portal design engine (real Postgres)', () => {
  let saved: NodeJS.ProcessEnv
  beforeEach(async () => {
    saved = { ...process.env }
    Object.assign(process.env, {
      BASE_URL: 'https://portal.example.com',
      SECRET_KEY: 'x'.repeat(48),
    })
    resetConfig()
    await testDb.delete(portalDesigns)
  })
  afterEach(() => {
    process.env = saved
    resetConfig()
  })

  const author = () => ({
    principalId: actor.principalId!,
    actor: { type: 'user' as const },
  })
  async function publish(design = defaultDesign()) {
    await saveDraft(design, author())
    await publishDraft({ ...author(), source: 'api' })
  }

  it('puts the logo and colour into the design draft once a design is published, where the old settings no longer reach', async () => {
    await setRow({ featureFlags: JSON.stringify({ portalDesignV2: true }) })
    await publish()
    await lookUpAndUse(actor)
    const state = await getDesignState()
    expect(state?.draft?.brand.logo.mark.light).toEqual({ key: good.logoKey })
    expect(state?.draft?.brand.light.accent.toLowerCase()).toBe(good.color!.toLowerCase())
    // The published design visitors see is unchanged until someone publishes.
    expect(state?.published?.document.brand.logo.mark.light).toBeNull()
  })

  it('keeps an icon and colour the design already has', async () => {
    await setRow({ featureFlags: JSON.stringify({ portalDesignV2: true }) })
    const own = defaultDesign()
    own.brand.logo.mark.light = { key: 'logos/own.png' }
    own.brand.light.accent = '#7a1f35'
    await publish(own)
    await lookUpAndUse(actor)
    expect((await getDesignState())?.draft).toBeNull()
  })

  it('leaves the design alone on the legacy theme', async () => {
    await publish()
    await lookUpAndUse(actor)
    expect((await getDesignState())?.draft).toBeNull()
    expect((await read()).logoKey).toBe(good.logoKey)
  })
})
