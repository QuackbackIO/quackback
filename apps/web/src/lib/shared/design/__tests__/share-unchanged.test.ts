import { describe, expect, it } from 'vitest'
import { defaultDesign } from '../schema'
import { shareUnchanged } from '../share-unchanged'

describe('shareUnchanged', () => {
  it('keeps every part a change did not touch as the very object it was', () => {
    const before = defaultDesign()
    const after = structuredClone(before)
    after.brand.light.accent = '#225544'
    const shared = shareUnchanged(before, after)
    expect(shared).toEqual(after)
    expect(shared).not.toBe(before)
    expect(shared.nav).toBe(before.nav)
    expect(shared.pages).toBe(before.pages)
    expect(shared.brand).not.toBe(before.brand)
    expect(shared.brand.light).not.toBe(before.brand.light)
    expect(shared.brand.dark).toBe(before.brand.dark)
  })

  it('is the design it was when nothing changed', () => {
    const before = defaultDesign()
    expect(shareUnchanged(before, structuredClone(before))).toBe(before)
  })

  it('sees a key added, removed or set to undefined as a change', () => {
    const before: Record<string, unknown> = { a: 1, b: { c: 2 } }
    expect(shareUnchanged(before, { a: 1, b: { c: 2 }, d: 3 })).not.toBe(before)
    expect(shareUnchanged(before, { a: 1 })).not.toBe(before)
    const unset = shareUnchanged(before, { a: 1, b: { c: 2 }, e: undefined })
    expect(unset).not.toBe(before)
    expect(Object.keys(unset)).toEqual(['a', 'b', 'e'])
    expect(unset.b).toBe(before.b)
  })

  it('keeps unchanged items of a list, and the list when only its length is the same', () => {
    const one = { id: 'x' }
    const two = { id: 'y' }
    const list = [one, two]
    const longer = shareUnchanged(list, [{ id: 'x' }, { id: 'y' }, { id: 'z' }])
    expect(longer).not.toBe(list)
    expect(longer[0]).toBe(one)
    expect(longer[1]).toBe(two)
    const moved = shareUnchanged(list, [{ id: 'y' }, { id: 'x' }])
    expect(moved).toEqual([two, one].map((item) => ({ ...item })))
    expect(moved).not.toBe(list)
  })

  it('takes the new value where a type changes', () => {
    expect(shareUnchanged<unknown>({ a: [1] }, { a: { 0: 1 } })).toEqual({ a: { 0: 1 } })
    expect(shareUnchanged<unknown>({ a: null }, { a: {} })).toEqual({ a: {} })
    expect(shareUnchanged<unknown>(1, '1')).toBe('1')
  })
})
