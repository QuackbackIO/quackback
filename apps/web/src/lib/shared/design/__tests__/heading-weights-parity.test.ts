import { describe, expect, it } from 'vitest'
import { HEADING_WEIGHTS } from '../fonts'
import { DESIGN_OPTIONS } from '../options'

describe('the heading weights', () => {
  it('are the same list where fonts are named as where designs are checked', () => {
    expect([...HEADING_WEIGHTS]).toEqual([...DESIGN_OPTIONS.headingWeight])
  })
})
