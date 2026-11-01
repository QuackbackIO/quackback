/**
 * A portal with its own CSS stays on its old theme until a person switches.
 * The switch publishes its branding converted, the theme variables its CSS
 * sets read in first, with the CSS carried over; switching back shows the old
 * theme again, untouched, and the switch can be made again.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { auditLog, eq, principal, settings, user } from '@/lib/server/db'

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
// The CSS is the portal's already, so the switch never asks the plan.
vi.mock('@/lib/server/domains/settings/tier-enforce', async () => {
  const { TierLimitError } = await import('@/lib/server/errors/tier-limit-error')
  return {
    assertTierFeature: async () => {
      throw new TierLimitError({ limit: 'features.customCss', message: 'Not on this plan.' })
    },
  }
})

const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
const { readDesignSwitch, switchBackFromDesign, switchPreviewView, switchToDesign } =
  await import('../switch')
const { config, resetConfig } = await import('@/lib/server/config')

const fixture = await createDbTestFixture()
let saved: NodeJS.ProcessEnv
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  saved = { ...process.env }
  Object.assign(process.env, { BASE_URL: 'https://portal.example.com', SECRET_KEY: 'x'.repeat(48) })
  resetConfig()
  await fixture.begin()
  await testDb.delete(settings)
})
afterEach(async () => {
  process.env = saved
  resetConfig()
  await fixture.rollback()
})
afterAll(fixture.close)

const CSS = [
  ':root { --primary: #0f766e; --ring: #111111; --brand-stripe: #ff0000; }',
  '.dark { --primary: #5eead4; }',
  '.portal-nav__item { font-weight: 700; }',
].join('\n')

async function workspace(
  customCss: string,
  flags: Record<string, boolean> = { portalDesignV2: true }
) {
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${createId('workspace').slice(-8)}`,
    createdAt: new Date(),
    featureFlags: JSON.stringify(flags),
    brandingConfig: JSON.stringify({ themeMode: 'light', light: { primary: '#7a1f35' } }),
    customCss,
    setupState: JSON.stringify({ version: 2, steps: { core: true, workspace: true }, goals: [] }),
  })
}

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

const engine = async () => (await getWorkspaceSettings())?.portalDesign

describe('switching a portal with its own CSS', () => {
  it('reports what becomes of the CSS before switching', async () => {
    await workspace(CSS)
    const state = await readDesignSwitch()
    expect(state).toMatchObject({ available: true, canSwitchBack: false })
    expect(state.report.errors).toEqual([])
    expect(state.report.carried.map((issue) => issue.message)).toEqual([
      '--primary on :root becomes the accent.',
      '--primary on .dark becomes the dark accent.',
    ])
    const warnings = state.report.warnings.map((issue) => issue.message)
    expect(warnings).toContainEqual(expect.stringMatching(/^--ring on :root stops applying/))
    expect(warnings).toContainEqual(expect.stringMatching(/^\.portal-nav__item is internal/))
    expect(warnings.join('\n')).not.toContain('--brand-stripe')
  })

  it('draws the switched portal for the preview, and only before switching', async () => {
    await workspace(CSS)
    expect(await engine()).toBeUndefined()
    const view = await switchPreviewView()
    expect(view?.engine === 'v2' && view.themeStyles).toContain('--qb-accent: #0f766e;')
    expect(view?.engine === 'v2' && view.customCss).toContain('.portal-nav__item')
    await switchToDesign(await author())
    expect(await switchPreviewView()).toBeNull()
  })

  it('publishes the converted design with the CSS, without asking the plan', async () => {
    await workspace(CSS)
    const who = await author()
    expect(await switchToDesign(who)).toEqual({ ok: true, number: 1 })
    const view = await engine()
    expect(view).toMatchObject({ engine: 'v2', revision: 1 })
    expect(view?.engine === 'v2' && view.themeStyles).toContain('--qb-accent: #0f766e;')
    expect(view?.engine === 'v2' && view.customCss).toBe(`@layer tenant {\n${CSS}\n}`)
    expect(await readDesignSwitch()).toMatchObject({ available: false, canSwitchBack: true })
    expect(await switchToDesign(who)).toMatchObject({ ok: false, code: 'DESIGN_CHANGED' })
  })

  it('switches back to the old theme, untouched, and can switch again', async () => {
    await workspace(CSS)
    const who = await author()
    await switchToDesign(who)
    expect(await switchBackFromDesign(who)).toEqual({ ok: true })
    expect(await engine()).toBeUndefined()
    const after = await getWorkspaceSettings()
    expect(after?.customCss).toBe(CSS)
    expect(after?.brandingConfig).toEqual({ themeMode: 'light', light: { primary: '#7a1f35' } })
    expect(await readDesignSwitch()).toMatchObject({ available: true })
    expect(await switchToDesign(who)).toEqual({ ok: true, number: 2 })

    const rows = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.actorUserId, who.actor.userId))
    expect(rows.map((row) => row.eventType).sort()).toEqual([
      'design.switched',
      'design.switched',
      'design.switched_back',
    ])
  })

  it('refuses CSS that reaches past styling, until it is fixed', async () => {
    await workspace('@import url(https://example.com/x.css);\nbody { color: red; }')
    const state = await readDesignSwitch()
    expect(state.available).toBe(true)
    expect(state.report.errors.map((issue) => issue.message)).toEqual([
      '@import is not allowed: put the CSS here instead.',
    ])
    expect(await switchToDesign(await author())).toMatchObject({ ok: false, code: 'INVALID_CSS' })
    expect(await engine()).toBeUndefined()
  })

  it('has nothing to switch without CSS, without the flag, or held on the old theme', async () => {
    const who = await author()
    await workspace('/* nothing yet */')
    expect(await readDesignSwitch()).toMatchObject({ available: false, canSwitchBack: false })
    expect(await switchToDesign(who)).toMatchObject({ ok: false, code: 'NOT_SWITCHABLE' })
    expect(await switchBackFromDesign(who)).toMatchObject({ ok: false, code: 'NOT_SWITCHED' })

    await testDb.delete(settings)
    await workspace(CSS, {})
    expect(await readDesignSwitch()).toMatchObject({ available: false })

    await testDb.delete(settings)
    await workspace(CSS)
    process.env.PORTAL_DESIGN_ENGINE = 'legacy'
    resetConfig()
    expect(config.portalDesignEngine).toBe('legacy')
    expect(await readDesignSwitch()).toMatchObject({ available: false })
    expect(await switchToDesign(who)).toMatchObject({ ok: false, code: 'NOT_SWITCHABLE' })
  })
})
