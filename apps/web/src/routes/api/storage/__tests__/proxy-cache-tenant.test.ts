/**
 * The storage proxy cache must be partitioned by tenant.
 *
 * It holds file BYTES keyed by storage key, in process memory. Storage keys are
 * per-bucket and the bucket is the tenant boundary, so one process serving two
 * tenants shares a key namespace *in its own heap* — and a hit returns the
 * other tenant's file with a 200 and no error. Unlike the `Vary` work this is
 * not an edge-cache concern: it needs no CDN and no misconfiguration, only a
 * key that appears in two buckets, which is exactly what an import or a
 * migration produces.
 *
 * **Two tests, because either alone is insufficient**, and the gap between them
 * is precisely how this shipped unpinned: reverting the call sites to the bare
 * key left the entire 11,710-test suite green.
 *
 *  - The behavioural test proves the key function partitions. It would stay
 *    green if every call site stopped using it.
 *  - The call-site scan proves the function is actually applied at every
 *    `proxyCache` access. It would stay green if the function stopped
 *    partitioning.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runWithTenantScope } from '@/lib/server/tenancy/tenant-context'
import { SINGLE_TENANT_NAMESPACE } from '@/lib/server/tenancy/tenant-keyed'
import { proxyCacheKey } from '../$'

const ROUTE = join(dirname(fileURLToPath(import.meta.url)), '..', '$.ts')

function scope(tenantId: string) {
  return { tenant: { tenantId }, db: {}, sql: {}, origin: 'test' } as never
}

describe('proxyCacheKey', () => {
  it('gives two tenants different keys for the SAME storage key', () => {
    const key = 'logos/2026/02/abc123-logo.png'
    const a = runWithTenantScope(scope('inst_a'), () => proxyCacheKey(key))
    const b = runWithTenantScope(scope('inst_b'), () => proxyCacheKey(key))
    expect(a).not.toBe(b)
    expect(a).toContain('inst_a')
    expect(b).toContain('inst_b')
  })

  it('is stable within one tenant, so the cache still caches', () => {
    const key = 'uploads/2026/02/x.png'
    const first = runWithTenantScope(scope('inst_a'), () => proxyCacheKey(key))
    const second = runWithTenantScope(scope('inst_a'), () => proxyCacheKey(key))
    expect(first).toBe(second)
  })

  it('uses the single-tenant namespace with no scope, so self-hosted is unchanged', () => {
    expect(proxyCacheKey('avatars/a.png')).toBe(`${SINGLE_TENANT_NAMESPACE} avatars/a.png`)
  })

  it('cannot be collided by a storage key that embeds another tenant id', () => {
    // The separator has to make `<tenant> <key>` unambiguous: without it,
    // tenant `a` with key `b/x` and tenant `ab` with key `/x` would collide.
    const a = runWithTenantScope(scope('a'), () => proxyCacheKey('b/x'))
    const b = runWithTenantScope(scope('ab'), () => proxyCacheKey('/x'))
    expect(a).not.toBe(b)
  })
})

describe('every proxyCache access is tenant-keyed', () => {
  const source = readFileSync(ROUTE, 'utf8')

  it('finds the cache accesses it is guarding', () => {
    // Without this, a renamed cache would make the assertion below vacuous.
    const accesses = source.match(/proxyCache\.(get|set|delete)\(/g) ?? []
    expect(accesses.length).toBeGreaterThanOrEqual(3)
  })

  it('passes proxyCacheKey(...) as the key at every access', () => {
    const offenders: string[] = []
    const re = /proxyCache\.(get|set|delete)\(\s*([^,)]+)/g
    for (const m of source.matchAll(re)) {
      const firstArg = (m[2] ?? '').trim()
      if (!firstArg.startsWith('proxyCacheKey(')) offenders.push(`${m[1]}(${firstArg})`)
    }
    expect(offenders).toEqual([])
  })
})
