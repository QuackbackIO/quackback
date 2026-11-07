import { describe, expect, it } from 'vitest'
import { LOGO_FILTER } from '@/lib/shared/design/logo'
import { LOGO_FILTER_IDS } from '../logo-filters'

describe('the header logo filters', () => {
  it('define the filters the design names', () => {
    expect(LOGO_FILTER_IDS).toEqual(LOGO_FILTER)
  })
})
