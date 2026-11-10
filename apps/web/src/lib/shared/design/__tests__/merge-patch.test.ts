/**
 * JSON merge patch (RFC 7386), which the REST API uses to change a draft:
 * objects merge, null removes a key, and anything else replaces.
 */
import { describe, expect, it } from 'vitest'
import { mergePatch } from '../merge-patch'

describe('mergePatch', () => {
  it('merges objects and replaces the rest', () => {
    const target = { brand: { light: { accent: '#000000', ink: '#111111' } }, list: [1, 2] }
    expect(mergePatch(target, { brand: { light: { accent: '#0f766e' } }, list: [3] })).toEqual({
      brand: { light: { accent: '#0f766e', ink: '#111111' } },
      list: [3],
    })
  })

  it('removes a key set to null', () => {
    expect(mergePatch({ a: 1, b: { c: 2, d: 3 } }, { b: { c: null } })).toEqual({
      a: 1,
      b: { d: 3 },
    })
  })

  it('leaves the target untouched', () => {
    const target = { a: { b: 1 } }
    mergePatch(target, { a: { b: 2 } })
    expect(target).toEqual({ a: { b: 1 } })
  })

  it('never writes a prototype key', () => {
    const patched = mergePatch({}, JSON.parse('{"__proto__": {"polluted": true}}')) as object
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(patched)).toBe(Object.prototype)
    expect(Object.keys(patched)).toEqual([])
  })
})
