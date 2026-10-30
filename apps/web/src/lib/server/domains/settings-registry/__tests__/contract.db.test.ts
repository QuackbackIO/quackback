/**
 * One generated contract per registry area, against real Postgres: read, dry
 * run, apply, undo, revision conflict and a locked field. A new area is covered by adding one case.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { auditLog, eq, principal, settings, user } from '@/lib/server/db'
import { ALL_PERMISSIONS } from '@/lib/shared/permissions'
import { ForbiddenError } from '@/lib/shared/errors'
import { SETTINGS_AREAS, type SettingsArea } from '@/lib/shared/settings-registry'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/config-file/managed-guard', () => ({
  assertNotManaged: async () => undefined,
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  invalidateSettingsCache: async () => undefined,
}))

import { applyWorkspaceSettingsProposal } from '@/lib/server/domains/assistant/workspace-settings-actions.service'
import {
  SETTINGS_REGISTRY,
  changeSettingsArea,
  listSettingsAreas,
  readSettingsArea,
  undoSettingsReceipt,
  type SettingsCaller,
} from '../index'

const fixture = await createDbTestFixture()
let actor: Actor
let caller: SettingsCaller
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  const userId = createId('user')
  const principalId = createId('principal')
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
  caller = { actor }
  await testDb.insert(settings).values({
    name: 'Acme',
    slug: `acme-${createId('workspace')}`,
    createdAt: new Date(),
    brandingConfig: '{}',
    widgetConfig: '{}',
    metadata: '{}',
    featureFlags: '{}',
    portalConfig: '{}',
  })
})
afterEach(() => fixture.rollback())
afterAll(() => fixture.close())

/** A patch that changes the area, from the value it holds now. */
const PATCHES: Record<SettingsArea, (current: Record<string, unknown>) => Record<string, unknown>> =
  {
    branding: () => ({ themeMode: 'dark' }),
    portal: () => ({ displayName: 'Acme Team' }),
    office_hours: () => ({ timezone: 'Europe/London' }),
    messenger: (current) => ({ welcomeMessage: `${current.welcomeMessage}Hello there` }),
    modules: (current) => ({ helpCenter: !current.helpCenter }),
    changelog: (current) => ({ emailsDisabled: !current.emailsDisabled }),
  }

/** The path a case reads back to see its change landed. */
const CHANGED: Record<SettingsArea, string> = {
  branding: 'themeMode',
  portal: 'displayName',
  office_hours: 'timezone',
  messenger: 'welcomeMessage',
  modules: 'helpCenter',
  changelog: 'emailsDisabled',
}

describe('every settings area keeps one contract', () => {
  it('covers each area the registry has', () => {
    expect(Object.keys(PATCHES).sort()).toEqual([...SETTINGS_AREAS].sort())
    expect(Object.keys(SETTINGS_REGISTRY).sort()).toEqual([...SETTINGS_AREAS].sort())
  })

  describe.each(SETTINGS_AREAS)('%s', (area) => {
    const entry = SETTINGS_REGISTRY[area]

    it('reads a value, a revision, locked fields and its gates', async () => {
      const read = await readSettingsArea(actor, area)
      expect(entry.readSchema.safeParse(read.value).success).toBe(true)
      expect(read.revision).toMatch(/^[0-9a-f]{32}$/)
      expect(read.risk).toBe(entry.risk)
      expect(read.locked).toEqual([])
      expect(read.gates).toEqual({ permission: entry.permission })
      expect(read.secrets).toEqual({})
      const listed = (await listSettingsAreas(actor)).find((a) => a.id === area)
      expect(listed).toMatchObject({ risk: entry.risk, revision: read.revision })
    })

    it('previews a change without writing it', async () => {
      const read = await readSettingsArea(actor, area)
      const patch = PATCHES[area](read.value)
      const result = await changeSettingsArea(caller, area, { patch, dryRun: true })
      expect(result).toMatchObject({
        status: 'dry_run',
        preview: { area, risk: entry.risk },
      })
      expect(result.status === 'dry_run' && result.preview.changes.length).toBeGreaterThan(0)
      expect((await readSettingsArea(actor, area)).revision).toBe(read.revision)
    })

    it('applies a change at once, with a receipt, an audit event and an undo', async () => {
      const read = await readSettingsArea(actor, area)
      const patch = PATCHES[area](read.value)
      const result = await changeSettingsArea(caller, area, {
        patch,
        expectedRevision: read.revision,
      })
      const changed = CHANGED[area]
      if (result.status !== 'applied') throw new Error(`expected applied, got ${result.status}`)
      expect(result.receipt.id).toMatch(/^audit_/)
      expect(result.receipt.undoable).toBe(true)
      expect(result.receipt.changes.length).toBeGreaterThan(0)
      expect(result.receipt.after[changed]).not.toEqual(result.receipt.before[changed])
      const after = await readSettingsArea(actor, area)
      expect(after.value[changed]).toEqual(result.receipt.after[changed])
      expect(after.revision).toBe(result.receipt.revision)
      expect(after.revision).not.toBe(read.revision)
      const [event] = await testDb
        .select()
        .from(auditLog)
        .where(eq(auditLog.id, result.receipt.id as never))
      expect(event).toMatchObject({ eventType: 'settings.applied', targetId: area })

      // Undo restores the value, and only once.
      const undone = await undoSettingsReceipt(caller, result.receipt.id)
      expect(undone).toMatchObject({ status: 'undone', result: { undone: true, area } })
      expect((await readSettingsArea(actor, area)).revision).toBe(read.revision)
      await expect(undoSettingsReceipt(caller, result.receipt.id)).rejects.toMatchObject({
        code: 'SETTINGS_UNDO_UNAVAILABLE',
      })
    })

    it('undoes a change a person applied from a settings card', async () => {
      const read = await readSettingsArea(actor, area)
      const changed = CHANGED[area]
      const { enqueueWorkspaceSettingsProposal } =
        await import('@/lib/server/domains/assistant/workspace-settings-actions.service')
      const card = await enqueueWorkspaceSettingsProposal(actor, [
        { area, patch: PATCHES[area](read.value) } as never,
      ])
      const ids = (card.args.changes as { id: string }[]).map((c) => c.id)
      await applyWorkspaceSettingsProposal(actor, card.id as never, ids, {
        contentHash: card.argsDigest!,
      })
      expect((await readSettingsArea(actor, area)).value[changed]).not.toEqual(read.value[changed])

      const undone = await undoSettingsReceipt(caller, card.id)
      expect(undone).toMatchObject({ status: 'undone', result: { area } })
      expect((await readSettingsArea(actor, area)).revision).toBe(read.revision)
      const [undoneEvent] = await testDb
        .select()
        .from(auditLog)
        .where(eq(auditLog.eventType, 'settings.undone'))
      expect(undoneEvent.metadata).toMatchObject({ area })
    })

    it('refuses a stale revision and applies nothing', async () => {
      const read = await readSettingsArea(actor, area)
      await expect(
        changeSettingsArea(caller, area, {
          patch: PATCHES[area](read.value),
          expectedRevision: '0'.repeat(32),
        })
      ).rejects.toMatchObject({ code: 'REVISION_MISMATCH', statusCode: 412 })
      expect((await readSettingsArea(actor, area)).revision).toBe(read.revision)
    })

    it('requires a revision to write', async () => {
      const read = await readSettingsArea(actor, area)
      await expect(
        changeSettingsArea(caller, area, { patch: PATCHES[area](read.value) })
      ).rejects.toMatchObject({ code: 'IF_MATCH_REQUIRED' })
    })

    it('refuses a locked field and applies nothing', async () => {
      const read = await readSettingsArea(actor, area)
      const patch = PATCHES[area](read.value)
      const field = Object.keys(patch)[0]
      const lock = vi
        .spyOn(entry, 'lockedFields')
        .mockReturnValue([{ field, reason: 'config_file' }])
      try {
        await expect(
          changeSettingsArea(caller, area, { patch, expectedRevision: read.revision })
        ).rejects.toMatchObject({ code: 'FIELD_LOCKED', statusCode: 423 })
        expect((await readSettingsArea(actor, area)).locked).toEqual([
          { field, reason: 'config_file' },
        ])
      } finally {
        lock.mockRestore()
      }
      expect((await readSettingsArea(actor, area)).revision).toBe(read.revision)
    })
  })

  it('locks the workspace name when the config file manages it', async () => {
    await testDb.update(settings).set({ managedFieldPaths: ['workspace.name'] })
    const read = await readSettingsArea(actor, 'portal')
    expect(read.locked).toEqual([{ field: 'displayName', reason: 'config_file' }])
    await expect(
      changeSettingsArea(caller, 'portal', {
        patch: { displayName: 'Other' },
        expectedRevision: read.revision,
      })
    ).rejects.toMatchObject({ code: 'FIELD_LOCKED' })
  })

  it('refuses an undo by a caller without the area permission', async () => {
    const read = await readSettingsArea(actor, 'portal')
    const applied = await changeSettingsArea(caller, 'portal', {
      patch: { displayName: 'Acme Team' },
      expectedRevision: read.revision,
    })
    if (applied.status !== 'applied') throw new Error('expected applied')
    const limited: SettingsCaller = { ...caller, actor: { ...actor, permissions: new Set() } }
    await expect(undoSettingsReceipt(limited, applied.receipt.id)).rejects.toMatchObject({
      code: 'SETTINGS_PERMISSION_REQUIRED',
    })
    expect((await readSettingsArea(actor, 'portal')).value.displayName).toBe('Acme Team')
  })

  it('answers 404 for a malformed receipt id', async () => {
    await expect(undoSettingsReceipt(caller, 'audit_nope')).rejects.toMatchObject({
      code: 'SETTINGS_RECEIPT_NOT_FOUND',
    })
  })

  it('checks the credential scope for the area before writing or undoing', async () => {
    const read = await readSettingsArea(actor, 'changelog')
    const scoped: SettingsCaller = {
      ...caller,
      assertAreaScope: () => {
        throw new ForbiddenError('FORBIDDEN', 'missing scope')
      },
    }
    await expect(
      changeSettingsArea(scoped, 'changelog', {
        patch: { emailsDisabled: true },
        expectedRevision: read.revision,
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it.each(['portal', 'messenger'] as const)(
    'refuses with the under-lock revision check when a write lands mid-request (%s)',
    async (area) => {
      const read = await readSettingsArea(actor, area)
      const patch = PATCHES[area](read.value)
      // The competing write is issued while the request's first check holds
      // the row it already read, so only the check under the lock can refuse.
      const original = SETTINGS_REGISTRY[area].read
      let race: PromiseLike<unknown> | undefined
      const spy = vi.spyOn(SETTINGS_REGISTRY[area], 'read').mockImplementationOnce((row) => {
        race = testDb
          .update(settings)
          .set(
            area === 'portal'
              ? { name: 'Written meanwhile' }
              : { widgetConfig: JSON.stringify({ messenger: { welcomeMessage: 'meanwhile' } }) }
          )
          .then(() => undefined)
        return original(row)
      })
      try {
        await expect(
          changeSettingsArea(caller, area, { patch, expectedRevision: read.revision })
        ).rejects.toMatchObject({ code: 'REVISION_MISMATCH', statusCode: 412 })
        await race
      } finally {
        spy.mockRestore()
      }
    }
  )

  it('refuses a caller without the area permission', async () => {
    const limited: SettingsCaller = {
      ...caller,
      actor: { ...actor, permissions: new Set() },
    }
    await expect(readSettingsArea(limited.actor, 'portal')).rejects.toMatchObject({
      code: 'SETTINGS_PERMISSION_REQUIRED',
    })
    expect(await listSettingsAreas(limited.actor)).toEqual([])
  })
})
