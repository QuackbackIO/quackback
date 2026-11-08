/**
 * The hero's call to action never takes the colour of what it sits on: with
 * buttons in a navy text colour on a navy band (Coralbank's goal), it takes the
 * brand colour; in the second colour on a panel of the second colour (Hemla's
 * yellow on yellow), the brand colour; where it already stands out, it is
 * left as the other buttons.
 */
import { describe, expect, it } from 'vitest'
import type { BrandChange } from '../brand-decide'
import { reconcile } from '../brand-decide'
import { heroActionChange } from '../hero-action'

const c = (path: string, value: unknown): BrandChange => ({ path, value, why: 'measured' })
const actionOf = (changes: BrandChange[]) =>
  reconcile(changes).find((x) => x.path === 'shape.action')

describe('the hero’s call to action', () => {
  it('takes the brand colour where ink buttons would sit on a band of the same navy', () => {
    const coralbank = [
      c('brand.light.accent', '#fb4e40'),
      c('brand.light.ink', '#0a0a0a'),
      c('brand.light.support', '#091622'),
      c('shape.fill', 'ink'),
      c('tune.button.fill', null),
      c('shape.action', null),
      c('layout.hero', 'support'),
      c('layout.heroShape', 'inset'),
    ]
    expect(heroActionChange(coralbank)?.value).toBe('accent')
    expect(actionOf(coralbank)?.value).toBe('accent')
  })

  it('takes the brand colour where a second-colour button would sit on a second-colour panel', () => {
    const hemla = [
      c('brand.light.accent', '#0456a5'),
      c('brand.light.ink', '#111111'),
      c('brand.light.support', '#fbdb04'),
      c('shape.fill', 'accent'),
      c('shape.action', 'support'),
      c('layout.hero', 'brand'),
      c('layout.heroShape', 'panel'),
    ]
    expect(actionOf(hemla)?.value).toBe('accent')
  })

  it('leaves a call to action that stands out as the other buttons', () => {
    const paylane = [
      c('brand.light.accent', '#533afb'),
      c('brand.light.support', '#fd9330'),
      c('shape.fill', 'accent'),
      c('shape.action', null),
      c('layout.hero', 'blend'),
    ]
    expect(heroActionChange(paylane)).toBeNull()
    expect(actionOf(paylane)?.value ?? null).toBeNull()
    const fernway = [
      c('brand.light.accent', '#153303'),
      c('brand.light.support', '#a7e479'),
      c('shape.fill', 'accent'),
      c('shape.action', null),
      c('layout.hero', 'support'),
    ]
    expect(heroActionChange(fernway)).toBeNull()
  })
})
