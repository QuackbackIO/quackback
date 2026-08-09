/**
 * `TenantKeyedCache` itself.
 *
 * It had no direct tests, and that is exactly how `tenantKeys()` shipped dead:
 * `compose()` and `clearTenant()` composed with a NUL separator while
 * `tenantKeys()` composed with a space, so it matched nothing and always
 * returned `[]`. Its only caller is the relay's retry-ledger prune, whose
 * failure mode is silent (memory, not behaviour) — and the test written to
 * cover it asserted a negative that held either way.
 *
 * The separator now lives in one place, but a shared constant is a convention
 * and this file is the check. Every method that composes a key is exercised
 * against every other, so the three can never again hold two opinions.
 */
import { describe, it, expect } from 'vitest'
import { TenantKeyedCache, tenantKey, currentTenantNamespace } from '../tenant-keyed'
import { withTenant } from '@/lib/server/__tests__/tenant-scope'

describe('the methods that compose a key agree with each other', () => {
  it('tenantKeys() returns what set() put in, for the active tenant', () => {
    const c = new TenantKeyedCache<number>()
    withTenant('tenant-alpha', () => {
      c.set('a', 1)
      c.set('b', 2)
    })

    expect(withTenant('tenant-alpha', () => c.tenantKeys().sort())).toEqual(['a', 'b'])
  })

  it('tenantKeys() shows one tenant only its own keys', () => {
    const c = new TenantKeyedCache<number>()
    withTenant('tenant-alpha', () => c.set('shared-key', 1))
    withTenant('tenant-bravo', () => c.set('bravo-only', 2))

    expect(withTenant('tenant-alpha', () => c.tenantKeys())).toEqual(['shared-key'])
    expect(withTenant('tenant-bravo', () => c.tenantKeys())).toEqual(['bravo-only'])
  })

  it('a key listed by tenantKeys() can be deleted with delete()', () => {
    // The exact round trip the relay's prune performs. With the two methods
    // composing differently this returned nothing to delete, so the ledger
    // never pruned while rows remained.
    const c = new TenantKeyedCache<number>()
    withTenant('tenant-alpha', () => {
      c.set('100', 1)
      c.set('200', 2)
      for (const k of c.tenantKeys()) {
        if (Number(k) < 200) c.delete(k)
      }
    })

    expect(withTenant('tenant-alpha', () => c.tenantKeys())).toEqual(['200'])
    expect(withTenant('tenant-alpha', () => c.get('100'))).toBeUndefined()
    expect(withTenant('tenant-alpha', () => c.get('200'))).toBe(2)
  })

  it('clearTenant() removes exactly what tenantKeys() listed, and nothing else', () => {
    const c = new TenantKeyedCache<number>()
    withTenant('tenant-alpha', () => c.set('a', 1))
    withTenant('tenant-bravo', () => c.set('b', 2))

    const listed = withTenant('tenant-alpha', () => c.tenantKeys())
    withTenant('tenant-alpha', () => c.clearTenant())

    expect(listed).toEqual(['a'])
    expect(withTenant('tenant-alpha', () => c.tenantKeys())).toEqual([])
    expect(withTenant('tenant-bravo', () => c.tenantKeys())).toEqual(['b'])
    expect(withTenant('tenant-bravo', () => c.get('b'))).toBe(2)
  })

  it('has()/get()/delete() all address the entry set() wrote', () => {
    const c = new TenantKeyedCache<string>()
    withTenant('tenant-alpha', () => {
      c.set('k', 'v')
      expect(c.has('k')).toBe(true)
      expect(c.get('k')).toBe('v')
      expect(c.delete('k')).toBe(true)
      expect(c.has('k')).toBe(false)
    })
  })
})

describe('separation between tenants', () => {
  it('two tenants hold the same key independently', () => {
    const c = new TenantKeyedCache<string>()
    withTenant('tenant-alpha', () => c.set('same', 'alpha'))
    withTenant('tenant-bravo', () => c.set('same', 'bravo'))

    expect(withTenant('tenant-alpha', () => c.get('same'))).toBe('alpha')
    expect(withTenant('tenant-bravo', () => c.get('same'))).toBe('bravo')
  })

  it('no (namespace, key) pair can collide with another', () => {
    // The reason the separator is NUL and not a space or a colon: a tenant id
    // or key containing the separator would otherwise let two different pairs
    // compose to one string. NUL cannot occur in either.
    const c = new TenantKeyedCache<string>()
    withTenant('tenant-a', () => c.set('b:c', 'first'))
    withTenant('tenant-a:b', () => c.set('c', 'second'))

    expect(withTenant('tenant-a', () => c.get('b:c'))).toBe('first')
    expect(withTenant('tenant-a:b', () => c.get('c'))).toBe('second')
  })

  it('memo() resolves once per tenant, not once per process', () => {
    const c = new TenantKeyedCache<string>()
    let calls = 0
    const factory = (t: string) => () => {
      calls += 1
      return t
    }

    expect(withTenant('tenant-alpha', () => c.memo('k', factory('alpha')))).toBe('alpha')
    expect(withTenant('tenant-alpha', () => c.memo('k', factory('alpha')))).toBe('alpha')
    expect(withTenant('tenant-bravo', () => c.memo('k', factory('bravo')))).toBe('bravo')

    expect(calls).toBe(2)
  })
})

describe('the single-tenant namespace', () => {
  it('is a stable `_`, never absent', () => {
    expect(currentTenantNamespace()).toBe('_')
    expect(tenantKey('settings:tenant')).toBe('t:_:settings:tenant')
  })

  it('is a namespace of its own, not a wildcard', () => {
    const c = new TenantKeyedCache<string>()
    c.set('k', 'unscoped')
    withTenant('tenant-alpha', () => c.set('k', 'alpha'))

    expect(c.get('k')).toBe('unscoped')
    expect(withTenant('tenant-alpha', () => c.get('k'))).toBe('alpha')
    expect(c.tenantKeys()).toEqual(['k'])
  })
})

describe('bounding', () => {
  it('evicts oldest-first past maxEntries, across tenants', () => {
    // The maps this replaces are unbounded, which in a pooled process is a slow
    // leak with a tenant-count multiplier.
    const c = new TenantKeyedCache<number>(2)
    withTenant('tenant-alpha', () => c.set('a', 1))
    withTenant('tenant-bravo', () => c.set('b', 2))
    withTenant('tenant-charlie', () => c.set('c', 3))

    expect(c.size).toBe(2)
    expect(withTenant('tenant-alpha', () => c.get('a'))).toBeUndefined()
    expect(withTenant('tenant-charlie', () => c.get('c'))).toBe(3)
  })

  it('re-setting a key refreshes its recency rather than adding a second entry', () => {
    const c = new TenantKeyedCache<number>(2)
    withTenant('tenant-alpha', () => {
      c.set('a', 1)
      c.set('a', 2)
    })

    expect(c.size).toBe(1)
    expect(withTenant('tenant-alpha', () => c.get('a'))).toBe(2)
  })
})
