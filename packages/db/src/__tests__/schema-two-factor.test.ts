import { describe, it, expect } from 'vitest'
import { eq, getTableColumns, getTableName } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { generateId } from '@quackback/ids'
import { twoFactor } from '../schema/auth'

/**
 * better-auth 1.6.30 writes `failedVerificationCount` / `lockedUntil` on
 * every TOTP verify. Drizzle drops unknown keys from `.set()` rather than
 * erroring, which produced `update "two_factor" set  where …` and 500'd
 * both enrolment and sign-in (#432). These assertions pin the columns on
 * the table object so a future plugin bump cannot silently drop them.
 */
describe('two_factor schema', () => {
  it('has correct table name', () => {
    expect(getTableName(twoFactor)).toBe('two_factor')
  })

  it('declares the better-auth 1.6.30 lockout columns', () => {
    const cols = getTableColumns(twoFactor)
    expect(Object.keys(cols)).toEqual(
      expect.arrayContaining(['failedVerificationCount', 'lockedUntil'])
    )
    expect(cols.failedVerificationCount.name).toBe('failed_verification_count')
    expect(cols.lockedUntil.name).toBe('locked_until')
    expect(cols.failedVerificationCount.notNull).toBe(true)
    expect(cols.lockedUntil.notNull).toBe(false)
  })

  it('emits a non-empty SET for the verify-success lockout reset', async () => {
    // The reproduction from #432: missing keys → `update "two_factor" set  where`.
    // postgres.js does not connect until a query runs; toSQL() is sync.
    const client = postgres('postgresql://postgres:password@127.0.0.1:1/unused', { max: 1 })
    const db = drizzle(client)
    try {
      const { sql } = db
        .update(twoFactor)
        .set({ failedVerificationCount: 0, lockedUntil: null })
        .where(eq(twoFactor.id, generateId('two_factor')))
        .toSQL()
      expect(sql).toMatch(/"failed_verification_count"/)
      expect(sql).toMatch(/"locked_until"/)
      expect(sql).not.toMatch(/set\s+where/i)
    } finally {
      await client.end({ timeout: 0 })
    }
  })
})
