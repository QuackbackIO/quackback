/**
 * The plan limits loaders against a real database: what counts as running
 * (custom domains serving visitors, custom CSS beyond the generated theme,
 * the assistant only where it answers, translation only with a model, active
 * webhooks and integrations, registered sign-in providers, live workflows)
 * and which rows are candidates for the choosers (never a deleted board or
 * status component).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  identityProvider,
  integrationPlatformCredentials,
  integrations,
  isNull,
  sql,
  statusComponents,
  webhooks,
  workflows,
} from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { generateReadableCSS } from '@/lib/shared/theme/readable-css'
import { unbrandedTheme } from '@/lib/shared/theme/expand'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: async () => null,
  cacheSet: async () => {},
  cacheDel: async () => {},
}))

import {
  loadBoardChoices,
  loadConfiguredFeatures,
  loadStatusComponentChoices,
  type ConfiguredFeatureSources,
} from '../plan-limits.loaders'
import { addBoard, addOwner, addStatusComponent, ensureSettings } from './plan-limits.db-seed'

const fixture = await createDbTestFixture()
afterAll(fixture.close)

function sources(over: Partial<ConfiguredFeatureSources> = {}): ConfiguredFeatureSources {
  return {
    customCss: null,
    liveCustomDomains: [],
    autoTranslate: false,
    assistantResponds: false,
    visitorChatLive: false,
    assistantModel: false,
    translationModel: false,
    ...over,
  }
}

const ANSWERING = { assistantResponds: true, assistantModel: true, visitorChatLive: true }

describe.skipIf(!fixture.available)('plan limits loaders (real DB)', () => {
  let ownerId: PrincipalId

  beforeEach(async () => {
    await fixture.begin()
    await testDb.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    await ensureSettings()
    ownerId = await addOwner()
  })
  afterEach(() => fixture.rollback())

  it('counts each live custom hostname once', async () => {
    const configured = await loadConfiguredFeatures(
      sources({ liveCustomDomains: ['help.acme.com', 'status.acme.com', 'help.acme.com'] })
    )
    expect(configured.customDomain).toBe(2)
    expect((await loadConfiguredFeatures(sources())).customDomain).toBe(0)
  })

  it('counts custom CSS only beyond the theme the appearance editor generates', async () => {
    expect((await loadConfiguredFeatures(sources({ customCss: '  \n ' }))).customCss).toBe(0)
    const generated = generateReadableCSS(unbrandedTheme('light'), unbrandedTheme('dark'), 'user')
    expect((await loadConfiguredFeatures(sources({ customCss: generated }))).customCss).toBe(0)
    const extra = `${generated}\n\n.acme-card { border-radius: 0 }`
    expect((await loadConfiguredFeatures(sources({ customCss: extra }))).customCss).toBe(1)
  })

  it('counts the assistant only when replies are on, a model is set and a visitor can reach it', async () => {
    expect((await loadConfiguredFeatures(sources(ANSWERING))).aiAssistant).toBe(1)
    for (const off of ['assistantResponds', 'assistantModel', 'visitorChatLive'] as const) {
      const configured = await loadConfiguredFeatures(sources({ ...ANSWERING, [off]: false }))
      expect(configured.aiAssistant, off).toBe(0)
    }
  })

  it('counts the assistant a live workflow hands conversations to, with no chat surface open', async () => {
    const closed = sources({ ...ANSWERING, visitorChatLive: false })
    const workflow = (status: 'live' | 'draft', type: string) => ({
      name: 'Acme triage',
      class: 'customer_facing' as const,
      status,
      triggerType: 'conversation.created',
      graph: { nodes: [{ id: 'n1', type }] },
    })
    await testDb.update(workflows).set({ status: 'paused' }).where(isNull(workflows.deletedAt))
    await testDb
      .insert(workflows)
      .values([workflow('draft', 'let_assistant_answer'), workflow('live', 'message')])
    expect((await loadConfiguredFeatures(closed)).aiAssistant).toBe(0)
    await testDb.insert(workflows).values(workflow('live', 'let_assistant_answer'))
    expect((await loadConfiguredFeatures(closed)).aiAssistant).toBe(1)
    expect(
      (await loadConfiguredFeatures({ ...closed, assistantResponds: false })).aiAssistant
    ).toBe(0)
  })

  it('counts translation only when it is on and a model is set', async () => {
    const on = sources({ autoTranslate: true, translationModel: true })
    expect((await loadConfiguredFeatures(on)).aiArticleTranslation).toBe(1)
    expect(
      (await loadConfiguredFeatures({ ...on, translationModel: false })).aiArticleTranslation
    ).toBe(0)
    expect(
      (await loadConfiguredFeatures({ ...on, autoTranslate: false })).aiArticleTranslation
    ).toBe(0)
  })

  it('counts a sign-in provider only when it is on and has a saved credential', async () => {
    await testDb.update(identityProvider).set({ enabled: false })
    const provider = (registrationId: string, enabled: boolean) => ({
      registrationId,
      label: 'Acme SSO',
      clientId: 'acme-client',
      enabled,
    })
    await testDb
      .insert(identityProvider)
      .values([provider('acme-on', true), provider('acme-off', false), provider('acme-bare', true)])
    await testDb.insert(integrationPlatformCredentials).values([
      { integrationType: 'auth_acme-on', secrets: 'x' },
      { integrationType: 'auth_acme-off', secrets: 'x' },
    ])
    expect((await loadConfiguredFeatures(sources())).sso).toBe(1)
  })

  it('counts active integrations, not pending or disconnected ones', async () => {
    await testDb.update(integrations).set({ status: 'disconnected' })
    await testDb.insert(integrations).values([
      { integrationType: 'acme_one', status: 'pending' },
      { integrationType: 'acme_two', status: 'disconnected' },
    ])
    expect((await loadConfiguredFeatures(sources())).integrations).toBe(0)
    await testDb.insert(integrations).values({ integrationType: 'acme_three', status: 'active' })
    expect((await loadConfiguredFeatures(sources())).integrations).toBe(1)
  })

  it('counts active webhooks, not switched-off or deleted ones', async () => {
    const before = (await loadConfiguredFeatures(sources())).webhooks ?? 0
    const hook = (status: 'active' | 'disabled', deletedAt: Date | null = null) => ({
      url: 'https://example.com/hook',
      secret: 'acme-secret',
      events: ['post.created'],
      createdById: ownerId,
      status,
      deletedAt,
    })
    await testDb
      .insert(webhooks)
      .values([hook('active'), hook('disabled'), hook('active', new Date())] as never)
    expect((await loadConfiguredFeatures(sources())).webhooks).toBe(before + 1)
  })

  it('never offers a deleted board or status component', async () => {
    const kept = await addBoard('Acme kept', 0, new Date('2026-01-01'), ownerId)
    const gone = await addBoard('Acme gone', 0, new Date('2026-01-02'), ownerId)
    await testDb.update(boards).set({ deletedAt: new Date() }).where(eq(boards.id, gone))
    const boardIds = (await loadBoardChoices()).map((b) => b.id)
    expect(boardIds).toContain(kept)
    expect(boardIds).not.toContain(gone)

    const shown = await addStatusComponent('Acme API', 0)
    const hidden = await addStatusComponent('Acme Old', 1)
    await testDb
      .update(statusComponents)
      .set({ deletedAt: new Date() })
      .where(eq(statusComponents.id, hidden))
    const componentIds = (await loadStatusComponentChoices()).map((c) => c.id)
    expect(componentIds).toContain(shown)
    expect(componentIds).not.toContain(hidden)
  })
})
