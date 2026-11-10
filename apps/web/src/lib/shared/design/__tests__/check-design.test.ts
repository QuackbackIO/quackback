/**
 * The checks a save must pass, run where the builder makes a change, so a
 * state the server would refuse is never committed. Each refusal has a
 * one-line reason a person can act on.
 */
import { describe, expect, it } from 'vitest'
import { checkDesign } from '../check-design'
import { defaultDesign } from '../schema'

describe('checkDesign', () => {
  it('passes a design the server saves', () => {
    expect(checkDesign(defaultDesign())).toMatchObject({ ok: true })
  })

  it('refuses words that are too long, saying how long they may be', () => {
    const design = defaultDesign()
    design.nav.home.label = 'x'.repeat(41)
    const outcome = checkDesign(design)
    expect(outcome).toMatchObject({ ok: false, code: 'INVALID_DESIGN' })
    expect(outcome.ok === false && outcome.reason).toBe('Use 40 characters or fewer')
  })

  it('refuses a number out of range, saying the limit', () => {
    const design = defaultDesign()
    design.style = { button: { base: { radius: 9999 } } }
    const outcome = checkDesign(design)
    expect(outcome.ok === false && outcome.reason).toBe('Use 999 or less')
  })

  it('refuses a colour it cannot read, in its own words', () => {
    const design = defaultDesign()
    design.brand.light.accent = 'not a colour'
    const outcome = checkDesign(design)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('"not a colour" is not a colour a design can use')
  })
})
