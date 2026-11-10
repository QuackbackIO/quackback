import { describe, expect, it } from 'vitest'
import { defaultDesign } from '../schema'
import { resolveDesign, resolveDesignCached } from '../resolve'

describe('resolveDesignCached', () => {
  it('resolves one design object once, however many readers ask', () => {
    const design = defaultDesign()
    const first = resolveDesignCached(design)
    // resolveDesign makes a new result each time, so the same result is one resolve.
    expect(resolveDesign(design)).not.toBe(resolveDesign(design))
    expect(resolveDesignCached(design)).toBe(first)
    expect(first).toEqual(resolveDesign(design))
  })

  it('resolves a different object again, even with the same content', () => {
    const design = defaultDesign()
    const twin = structuredClone(design)
    expect(resolveDesignCached(twin)).not.toBe(resolveDesignCached(design))
    expect(resolveDesignCached(twin)).toEqual(resolveDesignCached(design))
  })

  it('resolves the next draft after a change, never the one before it', () => {
    const before = defaultDesign()
    const after = structuredClone(before)
    after.brand.light.accent = '#0f766e'
    expect(resolveDesignCached(before).tokens).not.toEqual(resolveDesignCached(after).tokens)
    expect(resolveDesignCached(after)).toEqual(resolveDesign(after))
  })
})
