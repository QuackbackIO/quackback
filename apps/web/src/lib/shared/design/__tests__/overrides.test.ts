import { describe, expect, it } from 'vitest'
import { releaseOverrides } from '../overrides'
import { defaultDesign } from '../schema'

const tuned = () => {
  const doc = defaultDesign()
  doc.tune = { headline: { size: 48, weight: 300 }, card: { radius: 4 } }
  return doc
}

describe('releaseOverrides', () => {
  it('lets a picked choice count, by removing the exact value it competes with', () => {
    const before = tuned()
    const next = structuredClone(before)
    next.brand.fonts.scale = 'display'
    expect(releaseOverrides(before, next)).toEqual(['headline.size'])
    expect(next.tune).toEqual({ headline: { weight: 300 }, card: { radius: 4 } })
  })

  it('removes a group, and the tune, once nothing is left in it', () => {
    const before = defaultDesign()
    before.tune = { card: { radius: 4 } }
    const next = structuredClone(before)
    next.shape.corners = next.shape.corners === 'sharp' ? 'pill' : 'sharp'
    expect(releaseOverrides(before, next)).toEqual(['card.radius'])
    expect(next).not.toHaveProperty('tune')
  })

  it('keeps exact values when no choice they compete with changed, or the change set them too', () => {
    const before = tuned()
    const same = structuredClone(before)
    same.layout.width = 'wide'
    expect(releaseOverrides(before, same)).toEqual([])
    const both = structuredClone(before)
    both.brand.fonts.scale = 'display'
    both.tune!.headline!.size = 60
    expect(releaseOverrides(before, both)).toEqual([])
    expect(both.tune?.headline?.size).toBe(60)
  })

  it('releases brand-wide styles the re-picked choice competes with, in light, dark and phone', () => {
    const before = defaultDesign()
    before.style = {
      postCard: { base: { radius: 4, background: '#ffffff' } },
      headline: { base: { size: 40 } },
    }
    before.stylePhone = { postCard: { base: { radius: 2 } } }
    before.styleDark = { button: { base: { background: '#111111' } } }
    const next = structuredClone(before)
    next.shape.corners = next.shape.corners === 'sharp' ? 'pill' : 'sharp'
    next.shape.fill = next.shape.fill === 'ink' ? 'accent' : 'ink'
    expect(releaseOverrides(before, next).sort()).toEqual(
      ['style.postCard.radius', 'stylePhone.postCard.radius', 'styleDark.button.background'].sort()
    )
    expect(next.style).toEqual({
      postCard: { base: { background: '#ffffff' } },
      headline: { base: { size: 40 } },
    })
    expect(next).not.toHaveProperty('stylePhone')
    expect(next).not.toHaveProperty('styleDark')
  })

  it('keeps a style the same change set', () => {
    const before = defaultDesign()
    before.style = { postCard: { base: { radius: 4 } } }
    const next = structuredClone(before)
    next.shape.corners = next.shape.corners === 'sharp' ? 'pill' : 'sharp'
    next.style!.postCard!.base!.radius = 9
    expect(releaseOverrides(before, next)).toEqual([])
    expect(next.style?.postCard?.base?.radius).toBe(9)
  })
})
