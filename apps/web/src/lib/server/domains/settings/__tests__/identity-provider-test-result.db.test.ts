/**
 * Real-Postgres proof of what `persistTestResult` writes about the ID token
 * nonce.
 *
 * The connection test decides whether sign-in sends a nonce, so the write has to
 * land only with a passing result, only against the configuration the test
 * started from, and without restamping `details_changed_at`: restamping would
 * cancel the very pass that produced the finding.
 *
 * Runs against copies of `identity_provider` and `settings` in a schema of this
 * suite's own, so nothing it writes is visible to any other suite.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import type { IdentityProviderId } from '@quackback/ids'

const suite = vi.hoisted(() => ({
  schema: `idp_test_result_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
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

// The auth instance and the settings cache live outside this suite's schema.
vi.mock('@/lib/server/auth', () => ({ resetAuth: vi.fn() }))
vi.mock('../settings.helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../settings.helpers')>()),
  invalidateSettingsCache: vi.fn(async () => {}),
}))

// Same sanctioned direct client import as the db test fixture: this suite
// builds its own connection rather than going through the global `db`.
// oxlint-disable-next-line no-restricted-imports
import { createDbFromSql } from '@quackback/db/client'
import { db, eq, identityProvider } from '@/lib/server/db'
import type { SsoTestCapture } from '@/lib/shared/sso-test-capture'
import { persistTestResult } from '../identity-providers.service'

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
  // A stale test database (a column the schema declares but no migration
  // added yet) skips the suite rather than failing it mid-test.
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

const detailsChangedAt = new Date('2026-01-01T00:00:00.000Z')
const capture = { version: 2 } as unknown as SsoTestCapture

let providerId: IdentityProviderId

beforeEach(async () => {
  if (!available) return
  await db.delete(identityProvider)
  const [row] = await db
    .insert(identityProvider)
    .values({
      registrationId: 'oidc_suite',
      label: 'Suite',
      clientId: 'client-1',
      detailsChangedAt,
    })
    .returning({ id: identityProvider.id })
  providerId = row!.id
})

async function stored() {
  const [row] = await db
    .select({
      idTokenNonce: identityProvider.idTokenNonce,
      detailsChangedAt: identityProvider.detailsChangedAt,
      lastSuccessfulTestAt: identityProvider.lastSuccessfulTestAt,
    })
    .from(identityProvider)
    .where(eq(identityProvider.id, providerId))
  return row!
}

const persist = (args: {
  outcome: 'success' | 'mapping_failed'
  idTokenNonce?: 'check' | 'off'
  expectedDetailsChangedAt?: string
}) =>
  persistTestResult(providerId, {
    expectedDetailsChangedAt: args.expectedDetailsChangedAt ?? detailsChangedAt.toISOString(),
    outcome: args.outcome,
    capture,
    ...(args.idTokenNonce ? { idTokenNonce: args.idTokenNonce } : {}),
  })

describe.skipIf(!available)('persistTestResult: ID token nonce', () => {
  it('stores off with a passing result, without restamping the connection', async () => {
    expect(await persist({ outcome: 'success', idTokenNonce: 'off' })).toBe('stamped')
    const row = await stored()
    expect(row.idTokenNonce).toBe('off')
    expect(row.lastSuccessfulTestAt).not.toBeNull()
    expect(row.detailsChangedAt?.toISOString()).toBe(detailsChangedAt.toISOString())
  })

  it('stores the default back when a later test finds the nonce echoed', async () => {
    await persist({ outcome: 'success', idTokenNonce: 'off' })
    expect((await stored()).idTokenNonce).toBe('off')
    await persist({ outcome: 'success', idTokenNonce: 'check' })
    expect((await stored()).idTokenNonce).toBeNull()
  })

  it('leaves the setting alone when the test learned nothing about the nonce', async () => {
    await persist({ outcome: 'success', idTokenNonce: 'off' })
    await persist({ outcome: 'success' })
    expect((await stored()).idTokenNonce).toBe('off')
  })

  it('does not change the setting from a test that did not pass', async () => {
    await persist({ outcome: 'mapping_failed', idTokenNonce: 'off' })
    expect((await stored()).idTokenNonce).toBeNull()
  })

  it('does not change the setting when the provider was edited mid-test', async () => {
    const result = await persist({
      outcome: 'success',
      idTokenNonce: 'off',
      expectedDetailsChangedAt: '2025-06-01T00:00:00.000Z',
    })
    expect(result).toBe('stale')
    expect((await stored()).idTokenNonce).toBeNull()
  })
})
