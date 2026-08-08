/**
 * The daily salt exists so a visitor key cannot be correlated across days. A
 * salt shared between tenants reintroduces exactly that correlation sideways:
 * the same IP and User-Agent hash to the same key in every workspace, so the
 * layer-1 key becomes a fleet-wide visitor identifier.
 *
 * Every case uses its OWN calendar day. The in-heap salt cache is module-scope
 * and survives `beforeEach`, so a shared day would let an entry cached by an
 * earlier case supply the difference a later case is trying to prove — the
 * assertions would hold with the namespacing removed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  store: new Map<string, string>(),
  setCalls: [] as string[],
}))

vi.mock('@/lib/server/redis', () => ({
  getRedis: () => ({
    set: async (key: string, value: string) => {
      hoisted.setCalls.push(key)
      // SET NX: the first writer wins, later writers observe that value.
      if (!hoisted.store.has(key)) hoisted.store.set(key, value)
      return 'OK'
    },
    get: async (key: string) => hoisted.store.get(key) ?? null,
  }),
}))

const { getDailySalt, computeVisitorHash } = await import('../visitor-hash')
const { withTenant } = await import('@/lib/server/__tests__/tenant-scope')

const VISITOR = { siteOrigin: 'https://shop.example.com', ip: '203.0.113.7', userAgent: 'UA/1' }

let dayCounter = 0
/** A calendar day no other case in this file has used. */
function freshDay(): { date: Date; key: string } {
  dayCounter += 1
  const key = `2026-08-${String(dayCounter).padStart(2, '0')}`
  return { date: new Date(`${key}T09:00:00Z`), key }
}

beforeEach(() => {
  hoisted.store.clear()
  hoisted.setCalls.length = 0
})

describe('daily salt', () => {
  it('writes a tenant-namespaced Redis key', async () => {
    const day = freshDay()
    await withTenant('tenant-alpha', () => getDailySalt(day.date))

    expect(hoisted.setCalls).toEqual([`t:tenant-alpha:visitor:salt:${day.key}`])
  })

  it('uses the single-tenant namespace when no tenant scope is active', async () => {
    const day = freshDay()
    await getDailySalt(day.date)

    expect(hoisted.setCalls).toEqual([`t:_:visitor:salt:${day.key}`])
  })

  it('gives two tenants different salts on the same day', async () => {
    const day = freshDay()
    const alpha = await withTenant('tenant-alpha', () => getDailySalt(day.date))
    const bravo = await withTenant('tenant-bravo', () => getDailySalt(day.date))

    expect(alpha).toBeTruthy()
    expect(bravo).toBeTruthy()
    expect(alpha).not.toBe(bravo)
  })

  it('gives two tenants different salts in the other order too', async () => {
    const day = freshDay()
    const bravo = await withTenant('tenant-bravo', () => getDailySalt(day.date))
    const alpha = await withTenant('tenant-alpha', () => getDailySalt(day.date))

    expect(bravo).toBeTruthy()
    expect(alpha).not.toBe(bravo)
  })

  it('is still stable within one tenant for one day, and served from the heap', async () => {
    const day = freshDay()
    const first = await withTenant('tenant-alpha', () => getDailySalt(day.date))
    const second = await withTenant('tenant-alpha', () => getDailySalt(day.date))

    expect(second).toBe(first)
    expect(hoisted.setCalls).toHaveLength(1)
  })
})

describe('visitor hash', () => {
  it('differs between tenants for the same visitor, same day', async () => {
    const day = freshDay()
    const alphaSalt = await withTenant('tenant-alpha', () => getDailySalt(day.date))
    const bravoSalt = await withTenant('tenant-bravo', () => getDailySalt(day.date))

    expect(computeVisitorHash({ salt: alphaSalt!, ...VISITOR })).not.toBe(
      computeVisitorHash({ salt: bravoSalt!, ...VISITOR })
    )
  })

  it('differs between tenants in the other order too', async () => {
    const day = freshDay()
    const bravoSalt = await withTenant('tenant-bravo', () => getDailySalt(day.date))
    const alphaSalt = await withTenant('tenant-alpha', () => getDailySalt(day.date))

    expect(computeVisitorHash({ salt: bravoSalt!, ...VISITOR })).not.toBe(
      computeVisitorHash({ salt: alphaSalt!, ...VISITOR })
    )
  })

  it('is identical within one tenant for the same visitor', async () => {
    const day = freshDay()
    const salt = await withTenant('tenant-alpha', () => getDailySalt(day.date))

    expect(computeVisitorHash({ salt: salt!, ...VISITOR })).toBe(
      computeVisitorHash({ salt: salt!, ...VISITOR })
    )
  })
})
