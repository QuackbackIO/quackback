/**
 * The launch plan's branding step. With the portal in the builder, it is done
 * when the PUBLISHED design carries the brand (a match that left a colour, or
 * an icon, colour and font), never on a workspace logo alone; a branded draft
 * waits as "matched, not published". It names the website the builder's brand
 * match starts from. A portal on the legacy theme keeps the
 * workspace logo rule.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { portalDesigns, principal, settings, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
// The shared cache table would make parallel files wait on each other's writes.
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
  cacheDel: vi.fn(async () => undefined),
}))
vi.mock('@/lib/server/domains/assistant', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/assistant')>()),
  isAssistantConfigured: () => false,
}))

const { loadLaunchStatus } = await import('../launch-status')
const { publishDraft, saveDraft } = await import('@/lib/server/domains/design/design.service')
const { defaultDesign } = await import('@/lib/shared/design/schema')
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
  await testDb.delete(portalDesigns)
})
afterEach(async () => {
  process.env = saved
  resetConfig()
  await fixture.rollback()
})
afterAll(fixture.close)

async function workspace(opts: { flagOn: boolean; logoKey?: string; domain?: string }) {
  await testDb.insert(settings).values({
    name: 'Acme',
    slug: `acme-${createId('workspace').slice(-8)}`,
    createdAt: new Date(),
    featureFlags: JSON.stringify({ portalDesignV2: opts.flagOn }),
    logoKey: opts.logoKey ?? null,
    setupState: JSON.stringify({ version: 2, steps: { core: true, workspace: true }, goals: [] }),
    ...(opts.domain && {
      metadata: JSON.stringify({
        brandingLookup: {
          version: 1,
          status: 'failed',
          domain: opts.domain,
          claimId: randomUUID(),
          ownerPrincipalId: createId('principal'),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      }),
    }),
  })
}

async function admin() {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Sam', email: `${userId}@acme.example` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return {
    principalId,
    actor: { userId, email: `${userId}@acme.example`, role: 'admin', type: 'user' as const },
  }
}

const statusFor = (principalId: PrincipalId) =>
  loadLaunchStatus({ principalId, role: 'admin', permissions: [] })

describe('the branding step in the builder', () => {
  it('is not done on a workspace logo alone', async () => {
    await workspace({ flagOn: true, logoKey: 'logos/acme.png' })
    const author = await admin()
    const status = await statusFor(author.principalId)
    expect(status.brandInBuilder).toBe(true)
    expect(status.hasBranding).toBe(false)
  })

  it('is not done while a brand match waits in the draft, which it names as matched', async () => {
    await workspace({ flagOn: true })
    const author = await admin()
    const doc = defaultDesign()
    doc.brand.matchedAt = new Date().toISOString()
    doc.brand.light.accent = '#0f766e'
    await saveDraft(doc, author)
    const status = await statusFor(author.principalId)
    expect(status.hasBranding).toBe(false)
    expect(status.brandDrafted).toBe(true)
  })

  it('is done once the brand match is published', async () => {
    await workspace({ flagOn: true })
    const author = await admin()
    const doc = defaultDesign()
    doc.brand.matchedAt = new Date().toISOString()
    doc.brand.light.accent = '#0f766e'
    await saveDraft(doc, author)
    await publishDraft({ ...author, source: 'api' })
    const status = await statusFor(author.principalId)
    expect(status.hasBranding).toBe(true)
    expect(status.brandDrafted).toBe(false)
  })

  it('is not done, nor waiting, after a published match that used only a favicon', async () => {
    await workspace({ flagOn: true })
    const author = await admin()
    const doc = defaultDesign()
    doc.brand.matchedAt = new Date().toISOString()
    doc.brand.favicon = { key: 'logos/acme-favicon.png' }
    await saveDraft(doc, author)
    await publishDraft({ ...author, source: 'api' })
    const status = await statusFor(author.principalId)
    expect(status.hasBranding).toBe(false)
    expect(status.brandDrafted).toBe(false)
  })

  it('is not waiting when the draft carries no brand', async () => {
    await workspace({ flagOn: true })
    const author = await admin()
    await saveDraft(defaultDesign(), author)
    expect((await statusFor(author.principalId)).brandDrafted).toBe(false)
  })

  it('is done when the published Brand kit has an icon, a colour and a font', async () => {
    await workspace({ flagOn: true })
    const author = await admin()
    const doc = defaultDesign()
    doc.brand.logo.mark.light = { key: 'logos/acme.png' }
    doc.brand.light.accent = '#0f766e'
    doc.brand.fonts.heading = { kind: 'bundled', id: 'source-serif' }
    await saveDraft(doc, author)
    await publishDraft({ ...author, source: 'api' })
    expect((await statusFor(author.principalId)).hasBranding).toBe(true)
  })

  it('is not done when the published Brand kit has only an icon and a colour', async () => {
    await workspace({ flagOn: true })
    const author = await admin()
    const doc = defaultDesign()
    doc.brand.logo.mark.light = { key: 'logos/acme.png' }
    doc.brand.light.accent = '#0f766e'
    await saveDraft(doc, author)
    await publishDraft({ ...author, source: 'api' })
    expect((await statusFor(author.principalId)).hasBranding).toBe(false)
  })

  it('names the website the brand lookup used', async () => {
    await workspace({ flagOn: true, domain: 'acme.com' })
    const author = await admin()
    expect((await statusFor(author.principalId)).brandDomain).toBe('acme.com')
  })
})

describe('the branding step on the legacy theme', () => {
  it('is done on the workspace logo, outside the builder', async () => {
    await workspace({ flagOn: false, logoKey: 'logos/acme.png' })
    const author = await admin()
    const status = await statusFor(author.principalId)
    expect(status.brandInBuilder).toBe(false)
    expect(status.hasBranding).toBe(true)
    expect(status.brandDrafted).toBe(false)
  })
})
