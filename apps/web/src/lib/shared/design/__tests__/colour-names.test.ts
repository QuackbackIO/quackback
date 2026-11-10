/** Colours said by name, and reasons kept only when a person can read them. */
import { describe, expect, it } from 'vitest'
import { colourName, plainReason, plainWords } from '../colour-names'

describe('plainWords', () => {
  it('drops a code after a name and names a code alone', () => {
    expect(plainWords('pink (#fb556d) as the brand colour')).toBe('pink as the brand colour')
    expect(plainWords('Buttons now turn #000000 on hover.')).toBe(
      'Buttons now turn black on hover.'
    )
    expect(plainWords('The page is oklch(0.98 0.01 90).')).toBe('The page is white.')
  })
})

describe('colourName', () => {
  it('names a pale tint by its hue, and only a near-colourless one white', () => {
    expect(colourName('#eef0fd')).toBe('pale indigo')
    expect(colourName('#e0e7ff')).toBe('pale indigo')
    expect(colourName('#eff6ff')).toBe('pale blue')
    expect(colourName('#ecfdf5')).toBe('pale green')
    expect(colourName('#fef2f2')).toBe('pale pink')
    expect(colourName('#ffffff')).toBe('white')
    expect(colourName('#f1f5f9')).toBe('white')
    expect(colourName('#4f46e5')).toBe('indigo')
  })
})

describe('plainReason', () => {
  it('keeps a plain reason and drops the builder’s own', () => {
    expect(plainReason('images are uploaded in the panel')).toBe('images are uploaded in the panel')
    expect(plainReason('Home has no block called x; its blocks are status_a1')).toBeNull()
    expect(
      plainReason('A tint background’s settings are written as JSON, such as {"a":1}')
    ).toBeNull()
    expect(plainReason('use a brand colour (accent, support)')).toBeNull()
    // A list of a setting's own fields is the builder's vocabulary, not a person's.
    expect(
      plainReason(
        'A gradient background has no colour; it takes stops, shape, direction, centre and strength'
      )
    ).toBeNull()
    expect(plainReason('Fields take borderColor, radius or shadow')).toBeNull()
  })

  it('says a setting asked for by its key is not there, without the key or the list', () => {
    expect(
      plainReason(
        'Theme has no setting called hero.composerWidth; it has accent, support, headingFont, and exact values such as headline.size'
      )
    ).toBe('Theme has no setting like that')
    expect(
      plainReason('The hero has no setting called sparkle; it has look, image, composerWidth')
    ).toBe('The hero has no setting like that')
  })
})
