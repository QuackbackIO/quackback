/**
 * A preview link shows the design being edited, as it was when the link was
 * made, to anyone holding it until it expires or is revoked. Only the token's
 * hash is stored, and a portal has a limited number of live links at once.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { auditLog, eq, portalDesignPreviewLinks, principal, settings, user } from '@/lib/server/db'
import { defaultDesign } from '@/lib/shared/design/schema'
import { isPreviewToken, PREVIEW_LINK_DAYS } from '@/lib/shared/design/preview-link'

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

const { saveDraft } = await import('../design.service')
const {
  createPreviewLink,
  listPreviewLinks,
  PREVIEW_LINKS_MAX,
  readPreviewLink,
  revokePreviewLink,
} = await import('../preview-links')
const { resetConfig } = await import('@/lib/server/config')

const fixture = await createDbTestFixture()
let saved: NodeJS.ProcessEnv
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  saved = { ...process.env }
  Object.assign(process.env, { BASE_URL: 'https://portal.example.com', SECRET_KEY: 'x'.repeat(48) })
  resetConfig()
  await fixture.begin()
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${createId('workspace').slice(-8)}`,
    createdAt: new Date(),
    featureFlags: JSON.stringify({ portalDesignV2: true }),
    setupState: JSON.stringify({ version: 2, steps: { core: true, workspace: true }, goals: [] }),
  })
})
afterEach(async () => {
  process.env = saved
  resetConfig()
  await fixture.rollback()
})
afterAll(fixture.close)

async function admin() {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Ada', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return {
    principalId,
    actor: { userId, email: `${userId}@example.com`, role: 'admin', type: 'user' as const },
  }
}

const withAccent = (accent: string) => {
  const doc = defaultDesign()
  doc.brand.light.accent = accent
  return doc
}

async function made(author: Awaited<ReturnType<typeof admin>>) {
  const result = await createPreviewLink(author)
  if (!result.ok) throw new Error(result.message)
  return result
}

const tokenOf = (url: string) => new URL(url).searchParams.get('share')!

describe('making a preview link', () => {
  it('gives a link to the portal with a long random token, shown once and stored as its hash', async () => {
    const author = await admin()
    const { url, link } = await made(author)
    expect(url.startsWith('https://portal.example.com/?share=')).toBe(true)
    const token = tokenOf(url)
    expect(isPreviewToken(token)).toBe(true)
    expect(token).not.toBe(tokenOf((await made(author)).url))

    const [row] = await testDb
      .select()
      .from(portalDesignPreviewLinks)
      .where(eq(portalDesignPreviewLinks.id, link.id))
    expect(row.tokenHash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(JSON.stringify(row)).not.toContain(token.slice(4))
  })

  it('expires a week on', async () => {
    const before = Date.now()
    const { link } = await made(await admin())
    const week = PREVIEW_LINK_DAYS * 24 * 60 * 60 * 1000
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThanOrEqual(before + week)
    expect(new Date(link.expiresAt).getTime()).toBeLessThan(Date.now() + week + 1000)
  })

  it('records who made it in the audit log, without the token', async () => {
    const author = await admin()
    const { url, link } = await made(author)
    // Only this link's rows: the shared test database holds other tests' too.
    const rows = (await testDb.select().from(auditLog)).filter((r) => r.targetId === link.id)
    expect(rows.map((r) => [r.eventType, r.targetId])).toEqual([
      ['design.preview_link.created', link.id],
    ])
    expect(JSON.stringify(rows)).not.toContain(tokenOf(url))
  })

  it('refuses once the portal has as many live links as it may', async () => {
    const author = await admin()
    for (let i = 0; i < PREVIEW_LINKS_MAX; i++) await made(author)
    expect(await createPreviewLink(author)).toMatchObject({ ok: false, code: 'PREVIEW_LINK_LIMIT' })

    // An expired or revoked link no longer counts.
    const [first, second] = await listPreviewLinks()
    await revokePreviewLink(first.id, author)
    await testDb
      .update(portalDesignPreviewLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(portalDesignPreviewLinks.id, second.id))
    expect((await createPreviewLink(author)).ok).toBe(true)
    expect((await createPreviewLink(author)).ok).toBe(true)
    expect((await createPreviewLink(author)).ok).toBe(false)
  })
})

describe('opening a preview link', () => {
  it('shows the draft as it was when the link was made, whatever changes after', async () => {
    const author = await admin()
    await saveDraft(withAccent('#0f766e'), author)
    const { url } = await made(author)
    await saveDraft(withAccent('#7a1f35'), author)

    const shown = await readPreviewLink(tokenOf(url))
    expect(shown?.state).toBe('shown')
    expect(shown?.state === 'shown' && shown.design.brand.light.accent).toBe('#0f766e')
  })

  it('shows nothing for a token it never made, or one that is not a token', async () => {
    await made(await admin())
    expect(await readPreviewLink(`qbp_${'A'.repeat(43)}`)).toBeNull()
    expect(await readPreviewLink('not-a-token')).toBeNull()
  })

  it('says the link has ended once it expires', async () => {
    const { url, link } = await made(await admin())
    await testDb
      .update(portalDesignPreviewLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(portalDesignPreviewLinks.id, link.id))
    expect(await readPreviewLink(tokenOf(url))).toEqual({ state: 'ended' })
    expect(await listPreviewLinks()).toEqual([])
  })

  it('says the link has ended once it is revoked, and records who revoked it', async () => {
    const author = await admin()
    const { url, link } = await made(author)
    const other = await made(author)
    expect(await revokePreviewLink(link.id, author)).toEqual({ ok: true })
    expect(await readPreviewLink(tokenOf(url))).toEqual({ state: 'ended' })
    expect((await readPreviewLink(tokenOf(other.url)))?.state).toBe('shown')
    expect((await listPreviewLinks()).map((l) => l.id)).toEqual([other.link.id])

    const events = await testDb.select().from(auditLog).where(eq(auditLog.targetId, link.id))
    expect(events.map((r) => r.eventType).sort()).toEqual([
      'design.preview_link.created',
      'design.preview_link.revoked',
    ])
    expect(await revokePreviewLink(link.id, author)).toMatchObject({
      ok: false,
      code: 'PREVIEW_LINK_NOT_FOUND',
    })
  })
})

describe('the live links', () => {
  it('lists each with who made it and when it expires, newest first', async () => {
    const author = await admin()
    const first = await made(author)
    await testDb
      .update(portalDesignPreviewLinks)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(portalDesignPreviewLinks.id, first.link.id))
    const second = await made(author)
    const links = await listPreviewLinks()
    expect(links.map((l) => l.id)).toEqual([second.link.id, first.link.id])
    expect(links[0]).toMatchObject({ createdBy: 'Ada', expiresAt: second.link.expiresAt })
    expect(JSON.stringify(links)).not.toContain('token')
  })
})
