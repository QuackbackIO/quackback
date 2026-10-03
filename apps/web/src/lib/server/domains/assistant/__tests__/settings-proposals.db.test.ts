import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  eq,
  sql,
  principal,
  user,
  settings,
  roles,
  apiKeys,
  principalRoleAssignments,
  type Transaction,
} from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { ALL_PERMISSIONS, PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'
import { expandTheme } from '@/lib/shared/theme/expand'
import { generateThemeCSS } from '@/lib/shared/theme/generator'

const guards = vi.hoisted(() => ({
  managed: new Set<string>(),
  objects: new Map<string, string>(),
}))
vi.mock('@/lib/server/config-file/managed-guard', () => ({
  assertNotManaged: async (key: string) => {
    if (guards.managed.has(key)) throw new Error(`Managed setting: ${key}`)
  },
}))
vi.mock('@/lib/server/storage/s3', async (original) => ({
  ...(await original<typeof import('@/lib/server/storage/s3')>()),
  getPublicUrlOrNull: (key: string | null | undefined) => (key ? `/api/storage/${key}` : null),
  deleteObject: async (key: string) => {
    guards.objects.delete(key)
  },
  getS3Object: async (key: string, range?: string) => {
    if (range !== 'bytes=0-0' || !guards.objects.has(key))
      throw new Error('Unknown scoped logo object')
    return {
      body: new ReadableStream({
        start(controller) {
          controller.close()
        },
      }),
      contentType: 'image/png',
    }
  },
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  invalidateSettingsCache: async () => undefined,
}))
import { resolveMcpActor } from '@/lib/server/mcp/resolve-actor'
import { saveLogoKey, saveFaviconKey } from '@/lib/server/domains/settings/settings.media'
import {
  applySettingsChangesInTransaction,
  prepareSettingsChanges,
  undoSettingsChangesInTransaction,
  prepareRehostedBrandingLogoChange,
  getSettingsForActor,
} from '../settings-proposals.service'
const fixture = await createDbTestFixture({
  probe: async (db) => {
    const current = getExecuteRows<{ name: string }>(
      await db.execute(sql`select current_database() as name`)
    )[0]
    if (!current?.name.startsWith('quackback_test'))
      throw new Error('Settings proposals tests require a quackback_test database')
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})
if (!fixture.available)
  throw new Error('Migrate quackback_test before running settings proposal tests')
let actor: Actor
let settingsId: WorkspaceId
if (fixture.available) {
  beforeEach(async () => {
    guards.managed.clear()
    guards.objects.clear()
    await fixture.begin()
    const userId = createId('user') as UserId
    const principalId = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
    await testDb
      .insert(principal)
      .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
    actor = {
      principalId,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set(ALL_PERMISSIONS),
    }
    const [row] = await testDb.select().from(settings).limit(1)
    const current =
      row ??
      (
        await testDb
          .insert(settings)
          .values({ name: 'Acme', slug: `acme-${userId}`, createdAt: new Date() })
          .returning()
      )[0]
    settingsId = current.id
    await testDb
      .update(settings)
      .set({
        brandingConfig: '{}',
        featureFlags: JSON.stringify({
          supportInbox: false,
          supportTickets: false,
          helpCenter: false,
          statusPage: false,
        }),
        widgetConfig: '{}',
        portalConfig: '{}',
        metadata: '{}',
        name: 'Acme',
        cloudIdentity: null,
      })
      .where(eq(settings.id, settingsId))
  })
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}
const tx = () => testDb as unknown as Transaction
const read = async () =>
  (await testDb.select().from(settings).where(eq(settings.id, settingsId)))[0]
const identity = (displayName = 'Acme') => ({
  version: 1,
  displayName,
  canonicalOrigin: 'https://acme.example.com',
  platformHostname: 'acme.example.com',
  customDomains: [],
  updatedAt: '2026-10-03T12:00:00.000Z',
})
describe.skipIf(!fixture.available)('settings proposal adapters (real Postgres)', () => {
  it('reads the operator name as readonly and refuses a local name proposal', async () => {
    await testDb
      .update(settings)
      .set({ name: 'Local Acme', cloudIdentity: identity('Acme team') })
      .where(eq(settings.id, settingsId))
    expect(await getSettingsForActor(actor, 'portal')).toMatchObject({
      settings: { displayName: 'Acme team' },
      readOnly: true,
      settingsHref: '/admin/settings/general',
    })
    await expect(
      prepareSettingsChanges(actor, [{ area: 'portal', patch: { displayName: 'Local change' } }])
    ).rejects.toMatchObject({
      code: 'SETTINGS_NAME_MANAGED',
      message: expect.stringContaining('destination general'),
    })
    expect((await read()).name).toBe('Local Acme')
    const messenger = await prepareSettingsChanges(actor, [
      { area: 'messenger', patch: { enabled: true } },
    ])
    const messengerReceipt = await applySettingsChangesInTransaction(tx(), actor, messenger, [
      'messenger.enabled',
    ])
    expect(JSON.parse((await read()).featureFlags!).supportInbox).toBe(true)
    await undoSettingsChangesInTransaction(tx(), actor, messengerReceipt)
    expect(JSON.parse((await read()).featureFlags!).supportInbox).toBe(false)
    await testDb
      .update(settings)
      .set({ cloudIdentity: { ...identity(), version: 0 } })
      .where(eq(settings.id, settingsId))
    expect(await getSettingsForActor(actor, 'portal')).toMatchObject({
      settings: { displayName: 'Local Acme' },
      readOnly: false,
    })
    expect(
      (
        await prepareSettingsChanges(actor, [
          { area: 'portal', patch: { displayName: 'Local change' } },
        ])
      ).changes
    ).toHaveLength(1)
  })
  it('refuses Apply under the settings lock when an operator identity becomes active', async () => {
    const proposal = await prepareSettingsChanges(actor, [
      { area: 'messenger', patch: { enabled: true } },
      { area: 'portal', patch: { displayName: 'Acme team' } },
    ])
    await testDb
      .update(settings)
      .set({ cloudIdentity: identity() })
      .where(eq(settings.id, settingsId))
    await expect(
      applySettingsChangesInTransaction(
        tx(),
        actor,
        proposal,
        proposal.changes.map((change) => change.id)
      )
    ).rejects.toMatchObject({ code: 'SETTINGS_NAME_MANAGED' })
    expect((await read()).name).toBe('Acme')
    expect(JSON.parse((await read()).featureFlags!).supportInbox).toBe(false)
  })
  it('refuses Undo of a name when an operator identity becomes active', async () => {
    const proposal = await prepareSettingsChanges(actor, [
      { area: 'portal', patch: { displayName: 'Acme team' } },
    ])
    const receipt = await applySettingsChangesInTransaction(tx(), actor, proposal, [
      'portal.displayName',
    ])
    await testDb
      .update(settings)
      .set({ cloudIdentity: identity('Acme team') })
      .where(eq(settings.id, settingsId))
    await expect(undoSettingsChangesInTransaction(tx(), actor, receipt)).rejects.toMatchObject({
      code: 'SETTINGS_NAME_MANAGED',
    })
    expect((await read()).name).toBe('Acme team')
  })
  it('exposes only the real portal name and requires both page and writer permissions', async () => {
    await testDb
      .update(settings)
      .set({ headerDisplayName: 'Unused header', headerDisplayMode: 'logo_only' })
      .where(eq(settings.id, settingsId))
    expect((await getSettingsForActor(actor, 'portal')).settings).toEqual({ displayName: 'Acme' })
    const proposal = await prepareSettingsChanges(actor, [
      { area: 'portal', patch: { displayName: 'Acme team' } },
    ])
    expect(proposal.changes[0].settingsHref).toBe('/admin/settings/general')
    for (const missing of [PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.SETTINGS_BRANDING]) {
      const restricted = {
        ...actor,
        permissions: new Set(ALL_PERMISSIONS.filter((permission) => permission !== missing)),
      }
      await expect(getSettingsForActor(restricted, 'portal')).rejects.toThrow(/Owner/)
      await expect(
        prepareSettingsChanges(restricted, [
          { area: 'portal', patch: { displayName: 'Forbidden' } },
        ])
      ).rejects.toThrow(/Owner/)
      await expect(
        applySettingsChangesInTransaction(tx(), restricted, proposal, ['portal.displayName'])
      ).rejects.toThrow(/Owner/)
    }
    const receipt = await applySettingsChangesInTransaction(tx(), actor, proposal, [
      'portal.displayName',
    ])
    expect((await getSettingsForActor(actor, 'portal')).settings).toEqual({
      displayName: 'Acme team',
    })
    for (const missing of [PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.SETTINGS_BRANDING]) {
      await expect(
        undoSettingsChangesInTransaction(
          tx(),
          {
            ...actor,
            permissions: new Set(ALL_PERMISSIONS.filter((permission) => permission !== missing)),
          },
          receipt
        )
      ).rejects.toThrow(/Owner/)
    }
    await undoSettingsChangesInTransaction(tx(), actor, receipt)
    expect((await getSettingsForActor(actor, 'portal')).settings).toEqual({ displayName: 'Acme' })
    expect(await read()).toMatchObject({
      headerDisplayName: 'Unused header',
      headerDisplayMode: 'logo_only',
    })
  })
  it('shows the rendered default brand color and Undo restores the absent override', async () => {
    await testDb.update(settings).set({ brandingConfig: null }).where(eq(settings.id, settingsId))
    const proposal = await prepareSettingsChanges(actor, [
      { area: 'branding', patch: { light: { primary: '#0F766E' } } },
    ])
    expect(proposal.changes[0]).toMatchObject({
      before: expandTheme({}, { mode: 'light' }).primary,
      after: '#0F766E',
    })
    expect((await read()).brandingConfig).toBeNull()
    const receipt = await applySettingsChangesInTransaction(tx(), actor, proposal, [
      'branding.light.primary',
    ])
    expect(JSON.parse((await read()).brandingConfig!)).toEqual({
      light: { primary: '#0F766E' },
    })
    await undoSettingsChangesInTransaction(tx(), actor, receipt)
    expect((await read()).brandingConfig).toBeNull()
  })
  it('writes an effective theme token while retaining the full branding form values for Undo', async () => {
    const stored = {
      preset: 'custom',
      themeMode: 'light' as const,
      light: {
        primary: '#123456',
        primaryForeground: '#fefefe',
        shadowMd: '0 1px 2px #111111',
        fontSans: 'Inter',
      },
    }
    await testDb
      .update(settings)
      .set({ brandingConfig: JSON.stringify(stored) })
      .where(eq(settings.id, settingsId))
    const proposal = await prepareSettingsChanges(actor, [
      { area: 'branding', patch: { light: { primary: '#0F766E' } } },
    ])
    const receipt = await applySettingsChangesInTransaction(tx(), actor, proposal, [
      'branding.light.primary',
    ])
    const applied = JSON.parse((await read()).brandingConfig!)
    expect(applied).toEqual({
      ...stored,
      light: { ...stored.light, primary: '#0F766E' },
    })
    expect(generateThemeCSS(applied)).toContain('--primary: #0F766E')
    expect(generateThemeCSS(applied)).not.toBe(generateThemeCSS(stored))
    await undoSettingsChangesInTransaction(tx(), actor, receipt)
    expect(JSON.parse((await read()).brandingConfig!)).toEqual(stored)
    expect(generateThemeCSS(JSON.parse((await read()).brandingConfig!))).toBe(
      generateThemeCSS(stored)
    )
  })
  it('applies a model patch over a page-saved config the model could not propose', async () => {
    const stored = {
      preset: 'retired-preset',
      themeMode: 'user',
      light: {
        primary: 'var(--brand)',
        background: 'white',
        accent: 'color-mix(in oklch, white 40%, black)',
        legacyToken: 'lab(52% 40 59)',
        radius: '0',
      },
    }
    await testDb
      .update(settings)
      .set({ brandingConfig: JSON.stringify(stored) })
      .where(eq(settings.id, settingsId))
    const proposal = await prepareSettingsChanges(actor, [
      { area: 'branding', patch: { dark: { primary: '#0F766E' } } },
    ])
    const receipt = await applySettingsChangesInTransaction(tx(), actor, proposal, [
      'branding.dark.primary',
    ])
    expect(JSON.parse((await read()).brandingConfig!)).toEqual({
      ...stored,
      dark: { primary: '#0F766E' },
    })
    await undoSettingsChangesInTransaction(tx(), actor, receipt)
    expect(JSON.parse((await read()).brandingConfig!)).toEqual(stored)
  })
  it('prepares without writing and applies only the checked stored field', async () => {
    const proposal = await prepareSettingsChanges(actor, [
      { area: 'portal', patch: { displayName: 'Acme team' } },
      { area: 'messenger', patch: { enabled: true } },
    ])
    expect((await read()).name).toBe('Acme')
    const receipt = await applySettingsChangesInTransaction(tx(), actor, proposal, [
      'portal.displayName',
    ])
    expect((await read()).name).toBe('Acme team')
    expect(JSON.parse((await read()).featureFlags!).supportInbox).toBe(false)
    await undoSettingsChangesInTransaction(tx(), actor, receipt)
    expect((await read()).name).toBe('Acme')
  })
  it('applies a partial office hours patch onto the stored schedule', async () => {
    const intervals = [
      { day: 1, start: '09:00', end: '17:00' },
      { day: 2, start: '10:00', end: '18:00' },
    ]
    const first = await prepareSettingsChanges(actor, [
      {
        area: 'office_hours',
        patch: { enabled: true, timezone: 'UTC', intervals, holidays: [] },
      },
    ])
    await applySettingsChangesInTransaction(
      tx(),
      actor,
      first,
      first.changes.map((change) => change.id)
    )
    const proposal = await prepareSettingsChanges(actor, [
      { area: 'office_hours', patch: { timezone: 'Europe/Paris' } },
    ])
    expect(proposal.changes.map((change) => change.id)).toEqual(['office_hours.timezone'])
    const receipt = await applySettingsChangesInTransaction(tx(), actor, proposal, [
      'office_hours.timezone',
    ])
    expect((await getSettingsForActor(actor, 'office_hours')).settings).toMatchObject({
      enabled: true,
      timezone: 'Europe/Paris',
      intervals,
    })
    await undoSettingsChangesInTransaction(tx(), actor, receipt)
    expect((await getSettingsForActor(actor, 'office_hours')).settings).toMatchObject({
      timezone: 'UTC',
      intervals,
    })
  })
  it('turns Messenger off with its own switch and leaves Support on', async () => {
    const liveWidget = { enabled: true, tabs: { messenger: true, feedback: true } }
    await testDb
      .update(settings)
      .set({
        featureFlags: JSON.stringify({ supportInbox: true, supportTickets: true }),
        widgetConfig: JSON.stringify(liveWidget),
      })
      .where(eq(settings.id, settingsId))
    const proposal = await prepareSettingsChanges(actor, [
      { area: 'messenger', patch: { enabled: false } },
    ])
    expect(proposal.changes).toEqual([
      expect.objectContaining({ id: 'messenger.enabled', effects: ['messengerTab'] }),
    ])
    const receipt = await applySettingsChangesInTransaction(tx(), actor, proposal, [
      'messenger.enabled',
    ])
    const applied = await read()
    expect(JSON.parse(applied.featureFlags!)).toMatchObject({
      supportInbox: true,
      supportTickets: true,
    })
    expect(JSON.parse(applied.widgetConfig!)).toMatchObject({
      enabled: true,
      tabs: { messenger: false, feedback: true },
    })
    await undoSettingsChangesInTransaction(tx(), actor, receipt)
    expect(JSON.parse((await read()).widgetConfig!)).toMatchObject(liveWidget)
  })
  it('turns Messenger on with the widget and Support it needs, and lists them', async () => {
    const proposal = await prepareSettingsChanges(actor, [
      { area: 'messenger', patch: { enabled: true } },
    ])
    expect(proposal.changes[0]!.effects).toEqual(['messengerTab', 'widget', 'supportInbox'])
    const receipt = await applySettingsChangesInTransaction(tx(), actor, proposal, [
      'messenger.enabled',
    ])
    const applied = await read()
    expect(JSON.parse(applied.featureFlags!).supportInbox).toBe(true)
    expect(JSON.parse(applied.widgetConfig!)).toMatchObject({
      enabled: true,
      tabs: { messenger: true },
    })
    await undoSettingsChangesInTransaction(tx(), actor, receipt)
    expect(JSON.parse((await read()).featureFlags!).supportInbox).toBe(false)
    expect(JSON.parse((await read()).widgetConfig!)).toEqual({})
  })
  it('refuses Messenger on when what it needs changed after the card was shown', async () => {
    await testDb
      .update(settings)
      .set({ featureFlags: JSON.stringify({ supportInbox: true }) })
      .where(eq(settings.id, settingsId))
    const proposal = await prepareSettingsChanges(actor, [
      { area: 'messenger', patch: { enabled: true } },
    ])
    expect(proposal.changes[0]!.effects).toEqual(['messengerTab', 'widget'])
    await testDb
      .update(settings)
      .set({ featureFlags: JSON.stringify({ supportInbox: false }) })
      .where(eq(settings.id, settingsId))
    await expect(
      applySettingsChangesInTransaction(tx(), actor, proposal, ['messenger.enabled'])
    ).rejects.toMatchObject({ code: 'SETTINGS_CHANGED' })
    expect(JSON.parse((await read()).featureFlags!).supportInbox).toBe(false)
  })
  it('undo restores coupled module activation and preserves unrelated settings', async () => {
    const proposal = await prepareSettingsChanges(actor, [
      { area: 'modules', patch: { supportInbox: true, statusPage: true } },
    ])
    const receipt = await applySettingsChangesInTransaction(
      tx(),
      actor,
      proposal,
      proposal.changes.map((c) => c.id)
    )
    const applied = await read()
    expect(JSON.parse(applied.widgetConfig!).enabled).toBe(true)
    expect(JSON.parse(applied.portalConfig!).support.enabled).toBe(true)
    expect(JSON.parse(applied.metadata!).statusSettings.enabled).toBe(true)
    await testDb
      .update(settings)
      .set({ metadata: JSON.stringify({ ...JSON.parse(applied.metadata!), unrelated: 'keep' }) })
      .where(eq(settings.id, settingsId))
    await undoSettingsChangesInTransaction(tx(), actor, receipt)
    const restored = await read()
    expect(JSON.parse(restored.featureFlags!).supportInbox).toBe(false)
    expect(JSON.parse(restored.widgetConfig!)).toEqual({})
    expect(JSON.parse(restored.portalConfig!)).toEqual({})
    expect(JSON.parse(restored.metadata!)).toEqual({ unrelated: 'keep' })
  })
  it('refuses changed Undo values without overwriting the later writer', async () => {
    const proposal = await prepareSettingsChanges(actor, [
      { area: 'portal', patch: { displayName: 'Acme team' } },
    ])
    const receipt = await applySettingsChangesInTransaction(tx(), actor, proposal, [
      'portal.displayName',
    ])
    await testDb.update(settings).set({ name: 'Later name' }).where(eq(settings.id, settingsId))
    await expect(undoSettingsChangesInTransaction(tx(), actor, receipt)).rejects.toThrow(/changed/i)
    expect((await read()).name).toBe('Later name')
  })
  it('rechecks assignment-derived permission on Apply and Undo', async () => {
    const proposal = await prepareSettingsChanges(actor, [
      { area: 'portal', patch: { displayName: 'Acme team' } },
    ])
    const [emptyRole] = await testDb
      .insert(roles)
      .values({ key: `empty-${createId('role')}`, name: 'No settings', isSystem: false })
      .returning()
    await testDb
      .insert(principalRoleAssignments)
      .values({ principalId: actor.principalId!, roleId: emptyRole.id })
    await expect(
      applySettingsChangesInTransaction(tx(), actor, proposal, ['portal.displayName'])
    ).rejects.toThrow(/permission|Owner/i)
    expect((await read()).name).toBe('Acme')
    await testDb
      .delete(principalRoleAssignments)
      .where(eq(principalRoleAssignments.principalId, actor.principalId!))
    const receipt = await applySettingsChangesInTransaction(tx(), actor, proposal, [
      'portal.displayName',
    ])
    await testDb
      .insert(principalRoleAssignments)
      .values({ principalId: actor.principalId!, roleId: emptyRole.id })
    await expect(undoSettingsChangesInTransaction(tx(), actor, receipt)).rejects.toThrow(
      /permission|Owner/i
    )
    expect((await read()).name).toBe('Acme team')
  })
  it('rolls back all selected areas when a later service refuses a managed setting', async () => {
    const proposal = await prepareSettingsChanges(actor, [
      { area: 'messenger', patch: { enabled: true } },
      { area: 'portal', patch: { displayName: 'Acme team' } },
    ])
    guards.managed.add('workspace.name')
    await expect(
      testDb.transaction(async (inner) =>
        applySettingsChangesInTransaction(
          inner,
          actor,
          proposal,
          proposal.changes.map((c) => c.id)
        )
      )
    ).rejects.toThrow(/Managed/)
    expect((await read()).name).toBe('Acme')
    expect(JSON.parse((await read()).featureFlags!).supportInbox).toBe(false)
    expect(JSON.parse((await read()).widgetConfig!)).toEqual({})
  })
  it('retains previous logo and favicon objects for Undo', async () => {
    guards.objects.set('logos/old.png', 'old logo')
    guards.objects.set('favicons/old.png', 'old icon')
    await testDb
      .update(settings)
      .set({ logoKey: 'logos/old.png', faviconKey: 'favicons/old.png' })
      .where(eq(settings.id, settingsId))
    await saveLogoKey('logos/new.png', { executor: tx() })
    await saveFaviconKey('favicons/new.png', { executor: tx() })
    expect((await read()).logoKey).toBe('logos/new.png')
    expect(guards.objects.get('logos/old.png')).toBe('old logo')
    expect(guards.objects.get('favicons/old.png')).toBe('old icon')
  })
  it('prepares a server rehosted logo, applies it, and restores the retained original', async () => {
    guards.objects.set('logos/rehosted.png', 'new logo')
    guards.objects.set('logos/original.png', 'original logo')
    await testDb
      .update(settings)
      .set({ logoKey: 'logos/original.png' })
      .where(eq(settings.id, settingsId))
    const proposal = await prepareRehostedBrandingLogoChange(actor, 'logos/rehosted.png')
    expect((await read()).logoKey).toBe('logos/original.png')
    expect(proposal.changes[0].afterPreview).toBe('/api/storage/logos/rehosted.png')
    const receipt = await applySettingsChangesInTransaction(tx(), actor, proposal, [
      'branding.logoKey',
    ])
    expect((await read()).logoKey).toBe('logos/rehosted.png')
    await undoSettingsChangesInTransaction(tx(), actor, receipt)
    expect((await read()).logoKey).toBe('logos/original.png')
    expect(guards.objects.get('logos/original.png')).toBe('original logo')
    guards.objects.set('https://example.com/logo.png', 'invalid URL')
    guards.objects.set('logos/../w/other/logo.png', 'invalid traversal')
    await expect(
      prepareRehostedBrandingLogoChange(
        { ...actor, permissions: new Set([PERMISSIONS.SETTINGS_BRANDING]) },
        'logos/rehosted.png'
      )
    ).rejects.toThrow(/Owner/)
    await expect(
      prepareRehostedBrandingLogoChange(actor, 'https://example.com/logo.png')
    ).rejects.toThrow()
    await expect(
      prepareRehostedBrandingLogoChange(actor, 'logos/../w/other/logo.png')
    ).rejects.toThrow()
    await expect(prepareRehostedBrandingLogoChange(actor, 'logos/missing.png')).rejects.toThrow()
  })
  it('never broadens an explicitly empty requester permission set', async () => {
    await expect(
      prepareSettingsChanges({ ...actor, permissions: new Set() }, [
        { area: 'portal', patch: { displayName: 'Acme team' } },
      ])
    ).rejects.toThrow(/Owner/)
  })
  it('binds an API-key proposal to its current human creator and refuses revoked ownership', async () => {
    const serviceId = createId('principal') as PrincipalId
    await testDb
      .insert(principal)
      .values({ id: serviceId, role: 'admin', type: 'service', createdAt: new Date() })
    const [key] = await testDb
      .insert(apiKeys)
      .values({
        name: 'Acme settings',
        keyHash: serviceId.replaceAll('-', '').padEnd(64, '0'),
        keyPrefix: 'qb_test_key',
        principalId: serviceId,
        createdById: actor.principalId,
        scopes: JSON.stringify(['write:settings']),
      })
      .returning()
    const auth = {
      principalId: serviceId,
      role: 'admin' as const,
      name: 'Acme',
      authMethod: 'api-key' as const,
      scopes: ['write:settings' as const],
    }
    expect((await resolveMcpActor(auth)).principalId).toBe(actor.principalId)
    const [emptyRole] = await testDb
      .insert(roles)
      .values({ key: `key-empty-${createId('role')}`, name: 'No settings', isSystem: false })
      .returning()
    await testDb
      .insert(principalRoleAssignments)
      .values({ principalId: actor.principalId!, roleId: emptyRole.id })
    expect((await resolveMcpActor(auth)).permissions!.size).toBe(0)
    await testDb
      .update(apiKeys)
      .set({ scopes: JSON.stringify(['read:settings']) })
      .where(eq(apiKeys.id, key.id))
    await expect(resolveMcpActor(auth, 'write:settings')).rejects.toThrow()
    expect((await resolveMcpActor(auth, 'read:settings')).principalId).toBe(actor.principalId)
    await testDb.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, key.id))
    await expect(resolveMcpActor(auth)).rejects.toThrow()
  })
  it('refuses stale proposals and unknown selections', async () => {
    const proposal = await prepareSettingsChanges(actor, [
      { area: 'portal', patch: { displayName: 'Acme team' } },
    ])
    await expect(
      applySettingsChangesInTransaction(tx(), actor, proposal, ['portal.authentication'])
    ).rejects.toThrow()
    await testDb.update(settings).set({ name: 'Later name' }).where(eq(settings.id, settingsId))
    await expect(
      applySettingsChangesInTransaction(tx(), actor, proposal, ['portal.displayName'])
    ).rejects.toThrow(/changed/i)
  })
})
