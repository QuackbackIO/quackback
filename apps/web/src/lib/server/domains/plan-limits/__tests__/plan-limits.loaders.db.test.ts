/**
 * The plan limits loaders against a real database: what counts as set up
 * (the custom domain in use across the identity projection and every section
 * hostname, custom CSS, active webhooks) and which rows are candidates for
 * the choosers (never a deleted board or status component).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, eq, sql, statusComponents, webhooks } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import type { StoredCloudIdentityProjection } from '@/lib/shared/db-types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
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

const NOW = '2026-11-01T00:00:00.000Z'

function identity(...hostnames: string[]): StoredCloudIdentityProjection {
  return {
    version: 1,
    displayName: 'Acme',
    canonicalOrigin: 'https://acme.example.com',
    platformHostname: 'acme.example.com',
    updatedAt: NOW,
    customDomains: hostnames.map((hostname) => ({
      hostname,
      readiness: 'ready',
      isPrimary: false,
      updatedAt: NOW,
    })),
  } as unknown as StoredCloudIdentityProjection
}

function sources(over: Partial<ConfiguredFeatureSources> = {}): ConfiguredFeatureSources {
  return {
    customCss: null,
    cloudIdentity: null,
    sectionHostnames: [],
    autoTranslate: false,
    assistantResponds: false,
    ...over,
  }
}

describe.skipIf(!fixture.available)('plan limits loaders (real DB)', () => {
  let ownerId: PrincipalId

  beforeEach(async () => {
    await fixture.begin()
    await testDb.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    await ensureSettings()
    ownerId = await addOwner()
  })
  afterEach(() => fixture.rollback())

  it('counts a custom domain set only on a section', async () => {
    const configured = await loadConfiguredFeatures(
      sources({ sectionHostnames: ['help.acme.com'] })
    )
    expect(configured.customDomain).toBe(1)
  })

  it('counts each hostname once across the identity projection and the sections', async () => {
    const configured = await loadConfiguredFeatures(
      sources({
        cloudIdentity: identity('feedback.acme.com', 'help.acme.com'),
        sectionHostnames: ['help.acme.com', 'status.acme.com'],
      })
    )
    expect(configured.customDomain).toBe(3)
    expect((await loadConfiguredFeatures(sources())).customDomain).toBe(0)
  })

  it('counts custom CSS only when it has content, and the assistant and translation only when on', async () => {
    expect((await loadConfiguredFeatures(sources({ customCss: '  \n ' }))).customCss).toBe(0)
    const on = await loadConfiguredFeatures(
      sources({ customCss: 'body { color: red }', assistantResponds: true, autoTranslate: true })
    )
    expect(on).toMatchObject({ customCss: 1, aiAssistant: 1, aiArticleTranslation: 1 })
    expect(await loadConfiguredFeatures(sources())).toMatchObject({
      aiAssistant: 0,
      aiArticleTranslation: 0,
    })
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
