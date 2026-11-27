/**
 * The languages settings area against real Postgres: extra languages need
 * their page labels and fit the plan, the main language is never also an
 * extra one, a new main language that is an extra language swaps in (and is
 * not undone by a receipt), and the help center fields also need the help
 * center permission.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, settings, user } from '@/lib/server/db'
import { ALL_PERMISSIONS, PERMISSIONS } from '@/lib/shared/permissions'
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

import {
  changeSettingsArea,
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

const DE_LABELS = {
  language: 'de',
  homepageTitle: 'Wie können wir helfen?',
  homepageDescription: '',
  searchPlaceholder: 'Suchen',
}

async function change(patch: Record<string, unknown>, who: SettingsCaller = caller) {
  const read = await readSettingsArea(who.actor, 'languages')
  return changeSettingsArea(who, 'languages', { patch, expectedRevision: read.revision })
}

describe('the languages settings area', () => {
  it('reads the main language, extra languages, labels, auto-translate and glossary', async () => {
    const read = await readSettingsArea(actor, 'languages')
    expect(read.value).toEqual({
      mainLanguage: 'en',
      visitorLanguage: 'own',
      extraLanguages: [],
      pageLabels: [],
      autoTranslate: false,
      glossary: [],
    })
  })

  it('adds an extra language with its page labels, and sets the glossary', async () => {
    const result = await change({
      extraLanguages: ['de'],
      pageLabels: [DE_LABELS],
      glossary: ['Quackback'],
      autoTranslate: true,
    })
    expect(result.status).toBe('applied')
    const read = await readSettingsArea(actor, 'languages')
    expect(read.value).toMatchObject({
      extraLanguages: ['de'],
      pageLabels: [DE_LABELS],
      glossary: ['Quackback'],
      autoTranslate: true,
    })
    if (result.status !== 'applied') return
    expect(result.receipt.undoable).toBe(true)
    await undoSettingsReceipt(caller, result.receipt.id)
    expect((await readSettingsArea(actor, 'languages')).value).toMatchObject({
      extraLanguages: [],
      glossary: [],
      autoTranslate: false,
    })
  })

  it('refuses an extra language without a homepage title', async () => {
    await expect(change({ extraLanguages: ['fr'] })).rejects.toMatchObject({
      code: 'HC_LOCALE_TITLE_REQUIRED',
    })
  })

  it('refuses the main language as an extra language', async () => {
    await expect(
      change({ extraLanguages: ['en'], pageLabels: [{ ...DE_LABELS, language: 'en' }] })
    ).rejects.toMatchObject({ code: 'HC_LOCALE_IS_DEFAULT' })
  })

  it("refuses more languages than the plan's cap", async () => {
    await testDb.update(settings).set({ tierLimits: { maxHelpCenterLocales: 1 } as never })
    await expect(change({ extraLanguages: ['de'], pageLabels: [DE_LABELS] })).rejects.toMatchObject(
      { code: expect.stringMatching(/LIMIT/) }
    )
  })

  describe('languages the plan holds', () => {
    const FR_LABELS = {
      ...DE_LABELS,
      language: 'fr',
      homepageTitle: 'Comment pouvons-nous aider ?',
    }
    async function overTheCap(graceEndsAt: Date) {
      await change({ extraLanguages: ['de', 'fr'], pageLabels: [DE_LABELS, FR_LABELS] })
      await testDb.update(settings).set({
        tierLimits: { maxHelpCenterLocales: 2 } as never,
        planLimitsState: {
          since: new Date(Date.now() - 10 * 86_400_000).toISOString(),
          graceEndsAt: graceEndsAt.toISOString(),
          limitsKey: 'test',
          overKeys: ['maxHelpCenterLocales'],
        },
      })
    }
    const renamed = { ...FR_LABELS, homepageTitle: 'Bonjour' }

    it('leaves the page labels of a language past the cap editable during the grace', async () => {
      await overTheCap(new Date(Date.now() + 86_400_000))
      await expect(change({ pageLabels: [DE_LABELS, renamed] })).resolves.toMatchObject({
        status: 'applied',
      })
    })

    it('keeps the page labels of a held language after the grace', async () => {
      await overTheCap(new Date(Date.now() - 86_400_000))
      await expect(change({ pageLabels: [DE_LABELS, renamed] })).rejects.toMatchObject({
        code: 'HC_LOCALE_HELD',
      })
      // The earliest-added language stays editable.
      await expect(
        change({ pageLabels: [{ ...DE_LABELS, homepageTitle: 'Hallo' }] })
      ).resolves.toMatchObject({ status: 'applied' })
    })

    it('refuses a new order that would free a held language, and lets removal free it', async () => {
      await overTheCap(new Date(Date.now() - 86_400_000))
      await expect(
        change({ extraLanguages: ['fr', 'de'], pageLabels: [renamed, DE_LABELS] })
      ).rejects.toMatchObject({ code: 'HC_LOCALE_HELD' })
      await expect(change({ extraLanguages: ['fr', 'de'] })).rejects.toMatchObject({
        code: 'HC_LOCALE_HELD',
      })
      await expect(change({ extraLanguages: ['fr'] })).resolves.toMatchObject({
        status: 'applied',
      })
    })
  })

  it('swaps in an extra language as the main language, and that receipt has no undo', async () => {
    await change({ extraLanguages: ['de'], pageLabels: [DE_LABELS] })
    const result = await change({ mainLanguage: 'de' })
    expect((await readSettingsArea(actor, 'languages')).value).toMatchObject({
      mainLanguage: 'de',
      extraLanguages: ['en'],
    })
    if (result.status !== 'applied') throw new Error('expected applied')
    expect(result.receipt.undoable).toBe(false)
    await expect(undoSettingsReceipt(caller, result.receipt.id)).rejects.toMatchObject({
      code: expect.stringMatching(/UNDO/),
    })
  })

  it('needs the help center permission for the help center fields only', async () => {
    const settingsOnly: SettingsCaller = {
      actor: {
        ...actor,
        permissions: new Set(ALL_PERMISSIONS.filter((p) => p !== PERMISSIONS.HELP_CENTER_MANAGE)),
      },
    }
    await expect(change({ visitorLanguage: 'main' }, settingsOnly)).resolves.toMatchObject({
      status: 'applied',
    })
    await expect(change({ glossary: ['Acme'] }, settingsOnly)).rejects.toMatchObject({
      code: 'SETTINGS_PERMISSION_REQUIRED',
    })
  })

  it('needs the help center permission to undo a help center field, as to change it', async () => {
    const settingsOnly: SettingsCaller = {
      actor: {
        ...actor,
        permissions: new Set(ALL_PERMISSIONS.filter((p) => p !== PERMISSIONS.HELP_CENTER_MANAGE)),
      },
    }
    const glossary = await change({ glossary: ['Acme'] })
    if (glossary.status !== 'applied') throw new Error('expected applied')
    await expect(undoSettingsReceipt(settingsOnly, glossary.receipt.id)).rejects.toMatchObject({
      code: 'SETTINGS_PERMISSION_REQUIRED',
    })
    expect((await readSettingsArea(actor, 'languages')).value).toMatchObject({
      glossary: ['Acme'],
    })

    // A change to the workspace-wide fields alone stays theirs to undo.
    const visitors = await change({ visitorLanguage: 'main' })
    if (visitors.status !== 'applied') throw new Error('expected applied')
    await expect(undoSettingsReceipt(settingsOnly, visitors.receipt.id)).resolves.not.toThrow()
  })
})
