/**
 * A hero image is stored no wider than a wide screen needs, with smaller
 * copies only where they save something.
 */
import { describe, expect, it } from 'vitest'
import { HERO_MAX_WIDTH, heroPlan } from '../hero-image'

describe('heroPlan', () => {
  it('draws a very wide image smaller, keeping its shape', () => {
    const plan = heroPlan(5120, 2880)
    expect(plan.scaled).toBe(true)
    expect(plan.stored).toEqual({ width: HERO_MAX_WIDTH, height: 1440 })
    expect(plan.copies).toEqual([640, 1280])
  })

  it('keeps an image that already fits as it is', () => {
    const plan = heroPlan(1600, 900)
    expect(plan.scaled).toBe(false)
    expect(plan.stored).toEqual({ width: 1600, height: 900 })
    expect(plan.copies).toEqual([640, 1280])
  })

  it('makes no copy close to the image’s own width, and none of a small image', () => {
    expect(heroPlan(1400, 800).copies).toEqual([640])
    expect(heroPlan(700, 400).copies).toEqual([])
  })
})
