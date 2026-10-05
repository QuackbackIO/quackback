/**
 * Real-Postgres proof of which redirect URI each identity provider sends.
 *
 * A provider recorded `legacy` (migration 0279 stamps the ones that predate
 * the callback move) keeps sending `/api/auth/oauth2/callback/<id>`; a
 * provider with no entry, which is every one created since, sends the current
 * `/api/auth/callback/<id>`; an admin switch flips one. Each case is read back through `listIdentityProviders` and fed to
 * `buildGenericOAuthConfigs`, the path the auth runtime registers from, so the
 * assertion is on the redirect URI sign-in would actually send.
 *
 * Runs against copies of `identity_provider` and `settings` in a schema of
 * this suite's own, so nothing it writes is visible to any other suite.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'

const suite = vi.hoisted(() => ({
  schema: `idp_redirect_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  db: null as unknown,
}))

// Domain code imports the global `db`; point it at this suite's schema.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const target = suite.db as Record<string | symbol, unknown>
        const value = target[prop]
        return typeof value === 'function' ? value.bind(target) : value
      },
    }
  ),
}))

// The auth instance, the settings cache and the credential store live outside
// this suite's schema.
vi.mock('@/lib/server/auth', () => ({ resetAuth: vi.fn() }))
vi.mock('../settings.helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settings.helpers')>()),
  invalidateSettingsCache: vi.fn(async () => {}),
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: vi.fn(async () => null),
  deletePlatformCredentials: vi.fn(async () => {}),
  getConfiguredIntegrationTypes: vi.fn(async () => new Set<string>()),
  hasPlatformCredentials: vi.fn(async () => false),
}))

// Same sanctioned direct client import as the db test fixture: this suite
// builds its own connection rather than going through the global `db`.
// oxlint-disable-next-line no-restricted-imports
import { createDbFromSql } from '@quackback/db/client'
import { db, identityProvider, settings } from '@/lib/server/db'
import { buildGenericOAuthConfigs } from '@/lib/server/auth/build-oauth-configs'
import {
  deleteIdentityProvider,
  listIdentityProviders,
  setIdentityProviderRedirectStyle,
  upsertIdentityProvider,
} from '../identity-providers.service'

let admin: postgres.Sql | null = null
let pool: postgres.Sql | null = null
let available = false
try {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('no test database')
  admin = postgres(url, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create schema ${suite.schema}`)
  for (const table of ['identity_provider', 'settings']) {
    await admin.unsafe(`create table ${suite.schema}.${table} (like public.${table} including all)`)
  }
  pool = postgres(url, {
    max: 2,
    onnotice: () => {},
    connection: { search_path: `${suite.schema}, public` },
  })
  suite.db = createDbFromSql(pool)
  await db.select().from(identityProvider).limit(0)
  available = true
} catch {
  // Local/unit-only runs without Postgres skip this integration proof.
}

afterAll(async () => {
  await pool?.end()
  await admin?.unsafe(`drop schema if exists ${suite.schema} cascade`).catch(() => {})
  await admin?.end()
})

const BASE_URL = 'https://feedback.example.com'
const STORED_AUTH_CONFIG = { oauth: { password: false }, openSignup: false }

beforeEach(async () => {
  if (!available) return
  await db.delete(identityProvider)
  await db.delete(settings)
  await db.insert(settings).values({
    name: 'Suite',
    slug: 'suite',
    createdAt: new Date(),
    authConfig: JSON.stringify(STORED_AUTH_CONFIG),
  })
})

/** A provider row, optionally recorded with a redirect style. */
async function seedProvider(registrationId: string, style?: 'legacy' | 'current') {
  const [row] = await db
    .insert(identityProvider)
    .values({
      registrationId,
      label: 'Existing',
      clientId: 'client-1',
      authorizationUrl: 'https://idp.example/authorize',
      tokenUrl: 'https://idp.example/token',
      enabled: true,
    })
    .returning({ id: identityProvider.id })
  if (style) {
    await db.update(settings).set({
      authConfig: JSON.stringify({
        ...(await storedAuthConfig()),
        oidcRedirectStyles: {
          ...((await storedAuthConfig()).oidcRedirectStyles as object),
          [registrationId]: style,
        },
      }),
    })
  }
  return row!.id
}

/** The redirect URI sign-in registers for `registrationId`, if overridden. */
async function sentRedirectUri(registrationId: string): Promise<string> {
  const providers = await listIdentityProviders()
  const configs = await buildGenericOAuthConfigs({
    providers,
    creds: async () => ({ clientSecret: 'secret' }),
    tierAllowsOidc: true,
    baseUrl: BASE_URL,
  })
  const config = configs.find((c) => c.providerId === registrationId)
  if (!config) throw new Error(`no config for ${registrationId}`)
  // No override means the library's own default, the current path.
  return config.redirectURI ?? `${BASE_URL}/api/auth/callback/${registrationId}`
}

async function storedAuthConfig(): Promise<Record<string, unknown>> {
  const [row] = await db.select({ authConfig: settings.authConfig }).from(settings)
  return JSON.parse(row!.authConfig ?? '{}')
}

describe.skipIf(!available)('identity provider redirect style', () => {
  it('keeps a provider recorded as legacy on the legacy redirect URI', async () => {
    await seedProvider('sso', 'legacy')

    const [provider] = await listIdentityProviders()
    expect(provider!.redirectStyle).toBe('legacy')
    expect(await sentRedirectUri('sso')).toBe(`${BASE_URL}/api/auth/oauth2/callback/sso`)
  })

  it('sends the current redirect URI for a provider with no entry', async () => {
    await seedProvider('oidc_plain')

    const [provider] = await listIdentityProviders()
    expect(provider!.redirectStyle).toBe('current')
    expect(await sentRedirectUri('oidc_plain')).toBe(`${BASE_URL}/api/auth/callback/oidc_plain`)
  })

  it('creates a provider on the current redirect URI without touching auth_config', async () => {
    const created = await upsertIdentityProvider({
      registrationId: 'oidc_new',
      label: 'New',
      clientId: 'client-2',
    })
    expect(created.redirectStyle).toBe('current')
    expect(await storedAuthConfig()).toEqual(STORED_AUTH_CONFIG)
  })

  it('switches a legacy provider to the current redirect URI and back', async () => {
    const id = await seedProvider('custom-oidc', 'legacy')

    const switched = await setIdentityProviderRedirectStyle(id, 'current')
    expect(switched?.redirectStyle).toBe('current')
    // A test through the old URL no longer vouches for the connection.
    expect(switched?.detailsChangedAt).not.toBeNull()
    expect(await sentRedirectUri('custom-oidc')).toBe(`${BASE_URL}/api/auth/callback/custom-oidc`)

    await setIdentityProviderRedirectStyle(id, 'legacy')
    expect(await sentRedirectUri('custom-oidc')).toBe(
      `${BASE_URL}/api/auth/oauth2/callback/custom-oidc`
    )
    // The rest of the stored JSON is left exactly as it was.
    expect(await storedAuthConfig()).toEqual({
      ...STORED_AUTH_CONFIG,
      oidcRedirectStyles: { 'custom-oidc': 'legacy' },
    })
  })

  it('switches only the provider asked for', async () => {
    const first = await seedProvider('sso', 'legacy')
    await seedProvider('custom-oidc', 'legacy')

    await setIdentityProviderRedirectStyle(first, 'current')

    expect(await sentRedirectUri('sso')).toBe(`${BASE_URL}/api/auth/callback/sso`)
    expect(await sentRedirectUri('custom-oidc')).toBe(
      `${BASE_URL}/api/auth/oauth2/callback/custom-oidc`
    )
  })

  it('forgets the style when the provider is deleted', async () => {
    const id = await seedProvider('oidc_gone', 'legacy')

    await deleteIdentityProvider(id)

    expect((await storedAuthConfig()).oidcRedirectStyles).toEqual({})
  })
})
