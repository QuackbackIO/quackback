/**
 * Integration tests for the unified sign-in methods startup backfill.
 *
 * Proves the merge is:
 *   - additive: portal-only social enables are OR-ed into authConfig.oauth;
 *   - monotonic: team methods are never removed;
 *   - magic-link-safe: magic-link is only enabled from an explicit portal true;
 *   - idempotent: a second run changes nothing.
 *
 * Each test runs inside a transaction that is rolled back so the shared test
 * DB is left clean.
 */

// Satisfy the config schema the db layer validates on first access.
process.env.SECRET_KEY = 'test-secret-key-that-is-at-least-32-characters-long'
process.env.BASE_URL = 'http://localhost:3000'
process.env.REDIS_URL = 'redis://localhost:6379'

import { describe, it, expect } from 'vitest'
import { db, eq, settings } from '@/lib/server/db'
import { backfillUnifiedSignInMethods } from '../backfill-signin-methods'

type Oauth = Record<string, boolean | undefined>

function readAuthOauth(json: string | null): Oauth {
  return (JSON.parse(json ?? '{}').oauth ?? {}) as Oauth
}

describe('backfillUnifiedSignInMethods', () => {
  it('unions team-only and portal-only social enables', async () => {
    await db
      .transaction(async (tx) => {
        await tx.delete(settings)
        const [row] = await tx
          .insert(settings)
          .values({
            name: 'T',
            slug: 'backfill-test-union',
            createdAt: new Date(),
            authConfig: JSON.stringify({ oauth: { google: true }, openSignup: false }),
            portalConfig: JSON.stringify({ oauth: { github: true } }),
          })
          .returning({ id: settings.id })

        await backfillUnifiedSignInMethods(tx)

        const [after] = await tx
          .select({ authConfig: settings.authConfig })
          .from(settings)
          .where(eq(settings.id, row.id))
          .limit(1)
        const merged = readAuthOauth(after.authConfig)
        expect(merged.google).toBe(true)
        expect(merged.github).toBe(true)

        throw new Error('__ROLLBACK__')
      })
      .catch((e) => {
        if ((e as Error).message !== '__ROLLBACK__') throw e
      })
  })

  it('keeps password on when either surface had it on; magic-link only when explicit', async () => {
    await db
      .transaction(async (tx) => {
        await tx.delete(settings)
        const [row] = await tx
          .insert(settings)
          .values({
            name: 'T',
            slug: 'backfill-test-password',
            createdAt: new Date(),
            authConfig: JSON.stringify({ oauth: { password: false }, openSignup: false }),
            portalConfig: JSON.stringify({ oauth: { password: true, magicLink: true } }),
          })
          .returning({ id: settings.id })

        await backfillUnifiedSignInMethods(tx)

        const [after] = await tx
          .select({ authConfig: settings.authConfig })
          .from(settings)
          .where(eq(settings.id, row.id))
          .limit(1)
        const merged = readAuthOauth(after.authConfig)
        expect(merged.password).toBe(true)
        expect(merged.magicLink).toBe(true)

        throw new Error('__ROLLBACK__')
      })
      .catch((e) => {
        if ((e as Error).message !== '__ROLLBACK__') throw e
      })
  })

  it('does not enable magic-link from an absent key (no implicit propagation)', async () => {
    await db
      .transaction(async (tx) => {
        await tx.delete(settings)
        const [row] = await tx
          .insert(settings)
          .values({
            name: 'T',
            slug: 'backfill-test-noml',
            createdAt: new Date(),
            authConfig: JSON.stringify({ oauth: { password: true }, openSignup: false }),
            portalConfig: JSON.stringify({ oauth: { password: true } }),
          })
          .returning({ id: settings.id })

        await backfillUnifiedSignInMethods(tx)

        const [after] = await tx
          .select({ authConfig: settings.authConfig })
          .from(settings)
          .where(eq(settings.id, row.id))
          .limit(1)
        expect(readAuthOauth(after.authConfig).magicLink).not.toBe(true)

        throw new Error('__ROLLBACK__')
      })
      .catch((e) => {
        if ((e as Error).message !== '__ROLLBACK__') throw e
      })
  })

  it('is idempotent', async () => {
    await db
      .transaction(async (tx) => {
        await tx.delete(settings)
        const [row] = await tx
          .insert(settings)
          .values({
            name: 'T',
            slug: 'backfill-test-idempotent',
            createdAt: new Date(),
            authConfig: JSON.stringify({ oauth: { google: true }, openSignup: false }),
            portalConfig: JSON.stringify({ oauth: { github: true } }),
          })
          .returning({ id: settings.id })

        await backfillUnifiedSignInMethods(tx)
        await backfillUnifiedSignInMethods(tx)

        const [after] = await tx
          .select({ authConfig: settings.authConfig })
          .from(settings)
          .where(eq(settings.id, row.id))
          .limit(1)
        const merged = readAuthOauth(after.authConfig)
        expect(merged.google).toBe(true)
        expect(merged.github).toBe(true)

        throw new Error('__ROLLBACK__')
      })
      .catch((e) => {
        if ((e as Error).message !== '__ROLLBACK__') throw e
      })
  })
})
