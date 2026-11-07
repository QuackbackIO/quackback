import { describe, expect, it } from 'vitest'
import { COLOUR_ROLES } from '@/lib/shared/content-html'
import { DESIGN_OPTIONS } from '../options'

describe('the brand colour roles', () => {
  it('are the same list where stored words are drawn as where designs are checked', () => {
    expect([...DESIGN_OPTIONS.colourRole]).toEqual([...COLOUR_ROLES])
  })
})
