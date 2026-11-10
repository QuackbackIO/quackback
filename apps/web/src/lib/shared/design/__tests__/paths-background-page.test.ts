import { describe, expect, it } from 'vitest'
import { DESIGN_OPTIONS } from '../options'
import { backgroundPageOf } from '../paths'

describe('backgroundPageOf', () => {
  it('names exactly the pages a background can be kept under', () => {
    for (const page of DESIGN_OPTIONS.backgroundPage) expect(backgroundPageOf(page)).toBe(page)
    expect(backgroundPageOf('settings')).toBeNull()
    expect(backgroundPageOf('toString')).toBeNull()
    expect(backgroundPageOf(null)).toBeNull()
    expect(backgroundPageOf(undefined)).toBeNull()
  })
})
