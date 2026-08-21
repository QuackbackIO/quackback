/**
 * The `REGISTERED_AUTH_PROVIDERS` cache, driven through the read path the login
 * UI actually uses.
 *
 * ## Why this file exists as well as the cache's own suites
 *
 * Those prove `cacheGet`/`cacheSet` discriminate the entry they are handed.
 * This one proves the thing the discriminator was for: that
 * `getRegisteredAuthProviders()` — the function `BootstrapData` calls on every
 * app boot — cannot serve one workspace the identity providers of another.
 *
 * The distinction is not academic. The Piece 1 critic planted exactly this
 * hazard against the live two-workspace fleet ("bravo's `/api/auth/providers`
 * offers alpha's OIDC provider") and the nine-family isolation probe suite
 * returned `PASS exit=0`. A provider id is a plausible string on either
 * workspace, so nothing about the response looks wrong from outside. The suite
 * documents nine families and never claimed §4 exhaustiveness; this is one of
 * the three §4 hazards it is blind to, and it needs an assertion of its own.
 *
 * ## What is faked, and what is not
 *
 * **The store is real, and the cache helpers are real.** That distinction is the
 * whole value of this file: mocking `cacheGet`/`cacheSet` would mean asserting
 * against a reimplementation of the discrimination rather than against the
 * production one, and the test would stay green with the production
 * discrimination removed. Here the real helpers, the real `pg-kv.ts` statements
 * and a real Postgres all run, and the only fakes are the four service reads
 * that decide what each workspace's provider list contains.
 *
 * The store behind those helpers is a single shared `kv_store` table,
 * deliberately: the hazard is that this cache SURVIVES a restart and is shared
 * between workspaces, so a per-workspace fake store would assume away the thing under
 * test. One table for both workspaces — under pooled tenancy a workspace additionally
 * has its own database, so this is the weaker of the two arrangements and the
 * right one to assert against. The separation has to come from `workspace_key`.
 *
 * This file replaced an `ioredis`-socket fake. Redis is gone, so faking that
 * socket would have meant asserting the shape of a wire key no code emits: the
 * cache would have been bypassed entirely and every negative assertion below
 * ("bravo does not see alpha's provider") would have held for the trivial
 * reason that nothing was cached at all.
 *
 * The database reads are stubbed per workspace so the two workspaces have
 * genuinely different providers — otherwise every assertion below would hold
 * with the discrimination removed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import {
  ensureKvSchema,
  withRealWorkspace,
  workspacePair,
  cleanupWorkspaces,
  closeHarness,
  testSql,
} from '@/lib/server/kv/__tests__/harness'

interface WorkspaceFixture {
  identityProviders: { registrationId: string; enabled: boolean }[]
  configuredTypes: string[]
  oauth: Record<string, boolean>
  customOidcProvider: boolean
}

const hoisted = vi.hoisted(() => ({
  fixtures: new Map<string, WorkspaceFixture>(),
  /** One entry per full recompute, so "did it recompute?" is observable. */
  computes: [] as string[],
  currentWorkspaceKey: (): string => '',
}))

function fixture(): WorkspaceFixture {
  return (
    hoisted.fixtures.get(hoisted.currentWorkspaceKey()) ?? {
      identityProviders: [],
      configuredTypes: [],
      oauth: {},
      customOidcProvider: false,
    }
  )
}

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  // Only `computeRegisteredAuthProviders` reads this, so it counts recomputes.
  getWorkspaceSettings: async () => {
    hoisted.computes.push(hoisted.currentWorkspaceKey())
    return { authConfig: { oauth: fixture().oauth } }
  },
}))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: async () => ({
    features: { customOidcProvider: fixture().customOidcProvider },
  }),
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getConfiguredIntegrationTypes: async () => new Set(fixture().configuredTypes),
}))
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: async () => fixture().identityProviders,
}))

const { getRegisteredAuthProviders, getRegisteredOidcProviderIds } =
  await import('../registered-providers')
const { CACHE_KEYS } = await import('@/lib/server/cache')
const { getCurrentWorkspace } = await import('@/lib/server/workspaces/workspace-context')

hoisted.currentWorkspaceKey = () => getCurrentWorkspace()?.workspaceKey ?? ''

const [ALPHA_ID, BRAVO_ID] = workspacePair()

const ALPHA: WorkspaceFixture = {
  identityProviders: [{ registrationId: 'alpha-workforce-idp', enabled: true }],
  configuredTypes: ['auth_alpha-workforce-idp', 'auth_google'],
  oauth: { google: true },
  customOidcProvider: true,
}
const BRAVO: WorkspaceFixture = {
  identityProviders: [{ registrationId: 'bravo-partner-idp', enabled: true }],
  configuredTypes: ['auth_bravo-partner-idp'],
  oauth: {},
  customOidcProvider: true,
}

beforeAll(async () => {
  await ensureKvSchema()
})

afterAll(async () => {
  await cleanupWorkspaces(ALPHA_ID, BRAVO_ID)
  await closeHarness()
})

beforeEach(async () => {
  // Both workspaces keep their ids across the file, so the cached rows have to go
  // between tests or each test would inherit the previous one's priming.
  await cleanupWorkspaces(ALPHA_ID, BRAVO_ID)
  hoisted.computes.length = 0
  hoisted.fixtures.clear()
  hoisted.fixtures.set(ALPHA_ID, ALPHA)
  hoisted.fixtures.set(BRAVO_ID, BRAVO)
})

describe('the fixture reaches the code under test', () => {
  // Falsification discipline: the assertions below are negatives ("bravo does
  // not offer alpha's provider"), and a negative holds trivially in a fixture
  // that never produces a provider at all. These two pin that each workspace
  // really does compute its own non-empty list first.
  it('alpha computes its own provider ids', async () => {
    expect(await withRealWorkspace(ALPHA_ID, () => getRegisteredAuthProviders())).toEqual([
      'alpha-workforce-idp',
      'google',
    ])
  })

  it('bravo computes its own provider ids', async () => {
    expect(await withRealWorkspace(BRAVO_ID, () => getRegisteredAuthProviders())).toEqual([
      'bravo-partner-idp',
    ])
  })

  it('the cache is really a cache — the second call does not recompute', async () => {
    await withRealWorkspace(ALPHA_ID, () => getRegisteredAuthProviders())
    expect(hoisted.computes).toEqual([ALPHA_ID])

    hoisted.computes.length = 0
    await withRealWorkspace(ALPHA_ID, () => getRegisteredAuthProviders())

    expect(hoisted.computes).toEqual([])
  })
})

describe('REGISTERED_AUTH_PROVIDERS does not cross workspaces', () => {
  it('bravo is not offered alpha’s OIDC provider when alpha primed the cache', async () => {
    await withRealWorkspace(ALPHA_ID, () => getRegisteredAuthProviders())
    const bravo = await withRealWorkspace(BRAVO_ID, () => getRegisteredAuthProviders())

    expect(bravo).not.toContain('alpha-workforce-idp')
    expect(bravo).not.toContain('google')
    expect(bravo).toEqual(['bravo-partner-idp'])
  })

  it('alpha is not offered bravo’s OIDC provider when bravo primed the cache', async () => {
    // Both directions. The Piece 1 round-4 finding was that detection depended
    // on which workspace's value happened to survive a shared store, so a
    // one-directional check here would be the same defect in a new place.
    await withRealWorkspace(BRAVO_ID, () => getRegisteredAuthProviders())
    const alpha = await withRealWorkspace(ALPHA_ID, () => getRegisteredAuthProviders())

    expect(alpha).not.toContain('bravo-partner-idp')
    expect(alpha).toEqual(['alpha-workforce-idp', 'google'])
  })

  it('writes two distinct rows for the same logical key, one per workspace', async () => {
    await withRealWorkspace(ALPHA_ID, () => getRegisteredAuthProviders())
    await withRealWorkspace(BRAVO_ID, () => getRegisteredAuthProviders())

    // The successor of "two distinct Redis keys": the logical key is byte-for-
    // byte the same on both rows, and `workspace_key` is the only thing keeping the
    // second write from overwriting the first. Scoped to this file's two workspace
    // ids — `quackback_test` is shared with every other checkout on the machine.
    const rows = await testSql()<{ workspace_key: string; key: string; value: string[] }[]>`
      SELECT workspace_key, key, value
      FROM kv_store
      WHERE key = ${CACHE_KEYS.REGISTERED_AUTH_PROVIDERS}
        AND workspace_key IN (${ALPHA_ID}, ${BRAVO_ID})
      ORDER BY workspace_key = ${ALPHA_ID} DESC
    `

    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.workspace_key)).toEqual([ALPHA_ID, BRAVO_ID])
    expect(new Set(rows.map((r) => r.key))).toEqual(new Set([CACHE_KEYS.REGISTERED_AUTH_PROVIDERS]))
    // And the two rows really do hold different answers, so "two rows" is not
    // two copies of one workspace's list.
    expect(rows[0].value).toEqual(['alpha-workforce-idp', 'google'])
    expect(rows[1].value).toEqual(['bravo-partner-idp'])
  })

  it('survives the cache: a value written under one workspace is unreachable from the other', async () => {
    // Plant alpha's answer, then ask bravo with a fixture that can only produce
    // an empty list. This is the restart case — the entry is already in the
    // store, nothing recomputed it for bravo. A read that missed `workspace_key`
    // would hand bravo alpha's providers.
    await withRealWorkspace(ALPHA_ID, () => getRegisteredAuthProviders())
    hoisted.fixtures.set(BRAVO_ID, { ...BRAVO, identityProviders: [], configuredTypes: [] })

    const bravo = await withRealWorkspace(BRAVO_ID, () => getRegisteredAuthProviders())

    expect(bravo).toEqual([])
  })
})

describe('the shared OIDC gate underneath it', () => {
  // getRegisteredOidcProviderIds is what the ENFORCEMENT path reads
  // (isHardBound / isAuthMethodAllowed), not just the UI mirror. It takes no
  // cache, but it reads getTierLimits() — which is itself a §4 cache — so a
  // leak there would surface here as a provider registering on the wrong plan.
  it('gates on the ACTIVE workspace’s tier flag, not a neighbour’s', async () => {
    hoisted.fixtures.set(BRAVO_ID, { ...BRAVO, customOidcProvider: false })

    expect([...(await withRealWorkspace(ALPHA_ID, () => getRegisteredOidcProviderIds()))]).toEqual([
      'alpha-workforce-idp',
    ])
    expect([...(await withRealWorkspace(BRAVO_ID, () => getRegisteredOidcProviderIds()))]).toEqual(
      []
    )
  })
})
