import { describe, expect, it } from 'vitest'
import { MAX_MARKER_SCOPES, readScopedMarker, seenScope, writeScopedMarker } from '../seen-scope'

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  const storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k)
    },
    setItem: (k: string, v: string) => {
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

describe('scoped markers', () => {
  it('ignores a marker saved before markers were kept per person, and removes it on write', () => {
    const { storage, store } = memoryStorage({ marker: 'old' })
    expect(readScopedMarker(storage, 'marker', 'user_a')).toBeNull()
    expect(store.get('marker')).toBe('old')

    writeScopedMarker(storage, 'marker', 'user_a', 'new')
    expect(readScopedMarker(storage, 'marker', 'user_a')).toBe('new')
    expect(store.has('marker')).toBe(false)
    expect(readScopedMarker(storage, 'marker', 'user_b')).toBeNull()
  })

  it('keeps only the most recently written people on a shared browser', () => {
    const { storage, store } = memoryStorage()
    for (let i = 0; i <= MAX_MARKER_SCOPES; i++) writeScopedMarker(storage, 'marker', `u${i}`, 'x')
    // u0 is the oldest of 21: its marker goes.
    expect(readScopedMarker(storage, 'marker', 'u0')).toBeNull()
    expect(readScopedMarker(storage, 'marker', 'u1')).toBe('x')

    // Writing again makes u1 recent, so the next newcomer evicts u2 instead.
    writeScopedMarker(storage, 'marker', 'u1', 'y')
    writeScopedMarker(storage, 'marker', 'newcomer', 'x')
    expect(readScopedMarker(storage, 'marker', 'u1')).toBe('y')
    expect(readScopedMarker(storage, 'marker', 'u2')).toBeNull()
    const markers = [...store.keys()].filter((k) => k.startsWith('marker:'))
    expect(markers).toHaveLength(MAX_MARKER_SCOPES)
  })

  it('starts the list over when it is corrupted', () => {
    const { storage } = memoryStorage({ 'marker.scopes': '{not json' })
    writeScopedMarker(storage, 'marker', 'user_a', 'x')
    expect(readScopedMarker(storage, 'marker', 'user_a')).toBe('x')
  })
})
