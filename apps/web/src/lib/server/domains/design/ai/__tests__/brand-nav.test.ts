import { describe, expect, it } from 'vitest'
import { typeAndShapeChanges } from '../brand-decide'
import { designFromMeasures } from '../../extract/measured-design'

const navOf = (m: Parameters<typeof designFromMeasures>[0]) =>
  typeAndShapeChanges(designFromMeasures(m), null).find((c) => c.path === 'layout.nav')

describe('the menu style of a brand match', () => {
  it('applies a detected style', () => {
    expect(navOf({ nav: { style: 'tabs', index: 1, items: [] } })?.value).toBe('tabs')
    expect(navOf({ nav: { style: 'pill', index: 1, items: [] } })?.value).toBe('pills')
    expect(navOf({ nav: { style: 'bold', index: 1, items: [] } })?.value).toBe('plain')
  })

  it('takes the quietest style when no current item shows, not the default grey pill', () => {
    expect(navOf({ nav: { style: 'none', index: -1, items: [] } })?.value).toBe('underline')
    expect(navOf({})?.value).toBe('underline')
  })
})
