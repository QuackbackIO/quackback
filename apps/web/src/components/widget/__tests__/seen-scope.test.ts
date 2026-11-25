import { describe, expect, it } from 'vitest'
import { adoptLegacyMarker, readScopedMarker, seenScope } from '../seen-scope'

function memoryStorage(initial: Record<string, string> = {}, opts: { failWrites?: boolean } = {}) {
  const store = new Map(Object.entries(initial))
  const storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      if (opts.failWrites) throw new Error('storage is full')
      store.delete(k)
    },
    setItem: (k: string, v: string) => {
      if (opts.failWrites) throw new Error('storage is full')
      store.set(k, v)
    },
  } satisfies Storage
  return { storage, store }
}

describe('seenScope', () => {
  it('has no scope until the identity round trip settles', () => {
    expect(seenScope({ id: 'user_a' }, false)).toBeNull()
    expect(seenScope(null, false)).toBeNull()
  })

  it('scopes to the person once settled, or to anonymous', () => {
    expect(seenScope({ id: 'user_a' }, true)).toBe('user_a')
    expect(seenScope(null, true)).toBe('anonymous')
  })
})

describe('readScopedMarker', () => {
  it('reads a marker saved before markers were kept per person without moving it', () => {
    const { storage, store } = memoryStorage({ marker: 'old' })
    expect(readScopedMarker(storage, 'marker', 'user_a')).toBe('old')
    expect(store.get('marker')).toBe('old')
    expect(store.has('marker:user_a')).toBe(false)
  })

  it('prefers the scoped marker', () => {
    const { storage } = memoryStorage({ marker: 'old', 'marker:user_a': 'new' })
    expect(readScopedMarker(storage, 'marker', 'user_a')).toBe('new')
  })
})

describe('adoptLegacyMarker', () => {
  it('moves the legacy marker to the scope, so the next person does not inherit it', () => {
    const { storage, store } = memoryStorage({ marker: 'old' })
    expect(adoptLegacyMarker(storage, 'marker', 'user_a')).toBe('old')
    expect(store.get('marker:user_a')).toBe('old')
    expect(store.has('marker')).toBe(false)
    expect(readScopedMarker(storage, 'marker', 'user_b')).toBeNull()
  })

  it('leaves an existing scoped marker and the legacy one alone', () => {
    const { storage, store } = memoryStorage({ marker: 'old', 'marker:user_a': 'new' })
    expect(adoptLegacyMarker(storage, 'marker', 'user_a')).toBe('new')
    expect(store.get('marker')).toBe('old')
  })

  it('still returns the legacy marker when storage refuses the write', () => {
    const { storage, store } = memoryStorage({ marker: 'old' }, { failWrites: true })
    expect(adoptLegacyMarker(storage, 'marker', 'user_a')).toBe('old')
    expect(store.get('marker')).toBe('old')
  })
})
