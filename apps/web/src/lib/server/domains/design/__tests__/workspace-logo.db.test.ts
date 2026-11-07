/**
 * A publish asked to use the portal's new logo in the admin and emails makes
 * it the workspace's logo in the same step: both land, or neither does. A
 * publish not asked leaves the workspace's logo alone.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { portalDesignRevisions, principal, settings, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
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

const actions = await import('../design.actions')
const { defaultDesign } = await import('@/lib/shared/design/schema')

const fixture = await createDbTestFixture()
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${createId('workspace').slice(-8)}`,
    createdAt: new Date(),
    logoKey: 'logos/workspace.png',
  })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function author() {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Admin', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return {
    principalId,
    actor: { userId, email: `${userId}@example.com`, role: 'admin', type: 'user' as const },
  }
}

const withMark = (key: string | null) => {
  const doc = defaultDesign()
  doc.brand.logo.mark.light = key ? { key } : null
  return doc
}
const workspaceLogo = async () => (await testDb.select().from(settings))[0]!.logoKey
const versions = async () => (await testDb.select().from(portalDesignRevisions)).length

describe('publishing with the workspace logo', () => {
  it('leaves the workspace logo alone unless asked', async () => {
    const who = await author()
    await actions.saveDesignDraft(withMark('header-logos/new.png'), who)
    expect(await actions.publishDesign({ ...who, source: 'appearance' })).toMatchObject({
      ok: true,
    })
    expect(await workspaceLogo()).toBe('logos/workspace.png')
  })

  it('makes the published portal logo the workspace logo when asked', async () => {
    const who = await author()
    await actions.saveDesignDraft(withMark('header-logos/new.png'), who)
    expect(
      await actions.publishDesign({ ...who, source: 'appearance', workspaceLogo: true })
    ).toMatchObject({ ok: true, number: 1 })
    expect(await workspaceLogo()).toBe('header-logos/new.png')
  })

  it('refuses, publishing nothing, a draft with no logo the admin and emails can show', async () => {
    const who = await author()
    for (const key of [null, 'header-logos/new.svg']) {
      await actions.saveDesignDraft(withMark(key), who)
      expect(
        await actions.publishDesign({ ...who, source: 'appearance', workspaceLogo: true })
      ).toMatchObject({ ok: false, code: 'NO_PORTAL_LOGO' })
    }
    expect(await versions()).toBe(0)
    expect(await workspaceLogo()).toBe('logos/workspace.png')
  })
})
