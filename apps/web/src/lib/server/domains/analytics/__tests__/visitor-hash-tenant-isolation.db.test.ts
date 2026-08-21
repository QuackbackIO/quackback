/**
 * The daily salt exists so a visitor key cannot be correlated across days. A
 * salt shared between tenants reintroduces exactly that correlation sideways:
 * the same IP and User-Agent hash to the same key in every workspace, so the
 * layer-1 key becomes a fleet-wide visitor identifier.
 *
 * Two layers have to hold for that not to happen, and this drives both together
 * against a real store: the row's `tenant_id`, and the in-heap `TenantKeyedCache`
 * that serves the beacon hot path. Its predecessor mocked the store, so it could
 * only ever have exercised the second.
 *
 * **Every case uses its OWN calendar day.** The heap cache is module-scope and
 * survives `beforeEach`, so a shared day would let an entry cached by an earlier
 * case supply the difference a later case is trying to prove — the assertions
 * would hold with the discriminator removed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  ensureKvSchema,
  withRealTenant,
  tenantPair,
  cleanupTenants,
  closeHarness,
  testSql,
} from '@/lib/server/kv/__tests__/harness'
import { getDailySalt, computeVisitorHash } from '../visitor-hash'

const [A, B] = tenantPair()
const VISITOR = { siteOrigin: 'https://shop.example.com', ip: '203.0.113.7', userAgent: 'UA/1' }

let dayCounter = 0
/** A calendar day no other case in this file has used. */
function freshDay(): { date: Date; key: string } {
  dayCounter += 1
  const key = `2026-08-${String(dayCounter).padStart(2, '0')}`
  return { date: new Date(`${key}T09:00:00Z`), key }
}

beforeAll(async () => {
  await ensureKvSchema()
})

afterAll(async () => {
  await cleanupTenants(A, B)
  await closeHarness()
})

describe('daily salt', () => {
  it('writes a row discriminated by tenant, under the day-keyed name', async () => {
    const day = freshDay()
    await withRealTenant(A, () => getDailySalt(day.date))

    const rows = await testSql()<{ tenant_id: string }[]>`
      SELECT tenant_id FROM kv_store WHERE key = ${`visitor:salt:${day.key}`}
    `
    expect(rows.map((r) => r.tenant_id)).toEqual([A])
  })

  it('gives two tenants different salts on the same day', async () => {
    const day = freshDay()
    const alpha = await withRealTenant(A, () => getDailySalt(day.date))
    const bravo = await withRealTenant(B, () => getDailySalt(day.date))

    expect(alpha).toBeTruthy()
    expect(bravo).toBeTruthy()
    expect(alpha).not.toBe(bravo)
  })

  it('gives two tenants different salts in the other order too', async () => {
    const day = freshDay()
    const bravo = await withRealTenant(B, () => getDailySalt(day.date))
    const alpha = await withRealTenant(A, () => getDailySalt(day.date))

    expect(bravo).toBeTruthy()
    expect(alpha).not.toBe(bravo)
  })

  it('is stable within one tenant for one day, and served from the heap after the first read', async () => {
    const day = freshDay()
    const first = await withRealTenant(A, () => getDailySalt(day.date))
    // Change the stored value behind the cache. A second call that still returns
    // the first value proves the heap served it; one that returns the new value
    // proves it did not.
    await testSql()`
      UPDATE kv_store SET value = '"tampered"'::jsonb
      WHERE tenant_id = ${A} AND key = ${`visitor:salt:${day.key}`}
    `
    expect(await withRealTenant(A, () => getDailySalt(day.date))).toBe(first)
  })

  it('the heap cache is itself per tenant — B does not read A’s memoised salt', async () => {
    const day = freshDay()
    const alpha = await withRealTenant(A, () => getDailySalt(day.date))
    // Nothing has been written for B on this day, so if the heap were shared it
    // would answer with A's salt without touching the store at all.
    const bravo = await withRealTenant(B, () => getDailySalt(day.date))
    expect(bravo).not.toBe(alpha)
  })
})

describe('visitor hash', () => {
  it('differs between tenants for the same visitor, same day', async () => {
    const day = freshDay()
    const alphaSalt = await withRealTenant(A, () => getDailySalt(day.date))
    const bravoSalt = await withRealTenant(B, () => getDailySalt(day.date))

    expect(computeVisitorHash({ salt: alphaSalt!, ...VISITOR })).not.toBe(
      computeVisitorHash({ salt: bravoSalt!, ...VISITOR })
    )
  })

  it('differs between tenants in the other order too', async () => {
    const day = freshDay()
    const bravoSalt = await withRealTenant(B, () => getDailySalt(day.date))
    const alphaSalt = await withRealTenant(A, () => getDailySalt(day.date))

    expect(computeVisitorHash({ salt: bravoSalt!, ...VISITOR })).not.toBe(
      computeVisitorHash({ salt: alphaSalt!, ...VISITOR })
    )
  })

  it('is identical within one tenant for the same visitor', async () => {
    const day = freshDay()
    const salt = await withRealTenant(A, () => getDailySalt(day.date))

    expect(computeVisitorHash({ salt: salt!, ...VISITOR })).toBe(
      computeVisitorHash({ salt: salt!, ...VISITOR })
    )
  })
})
