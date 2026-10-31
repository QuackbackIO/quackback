/**
 * The faithful look takes its hero as a screenshot shows it: the band and its
 * colour's role, a panel or an inset card, the words' side, the header on the
 * band, its art and capitals; a colour the screenshot does not bear out is
 * left to the look.
 */
import { describe, expect, it } from 'vitest'
import { DIRECTIONS_EXAMPLE } from '../design-looks'
import { confirmedBy } from '../faithful-look'
import { withHero, type HeroRead } from '../hero-read'

const hero = (read: Partial<HeroRead>): HeroRead => ({
  page: true,
  fill: 'colour',
  colour: '',
  panel: false,
  panelColour: '',
  card: false,
  align: 'left',
  headerOnHero: false,
  art: 'none',
  upper: false,
  ...read,
})

describe('the faithful look’s hero, as the screenshot shows it', () => {
  it('a band of the second colour, centred, with the header on it and capitals (Wise)', () => {
    const look = { ...DIRECTIONS_EXAMPLE, accent: '#163300', support: '' }
    const next = withHero(
      look,
      hero({ colour: '#9fe870', align: 'centre', headerOnHero: true, upper: true }),
      confirmedBy(['#9fe870', '#163300', '#ffffff'])
    )
    expect(next).toMatchObject({
      band: 'support',
      support: '#9fe870',
      bandAlign: 'centre',
      headerOnBand: true,
      headlineCase: 'upper',
      bandShape: 'full',
    })
  })

  it('a panel of the second colour in a band of the brand colour (IKEA)', () => {
    const look = { ...DIRECTIONS_EXAMPLE, accent: '#0058a3' }
    const next = withHero(
      look,
      hero({ colour: '#0058a3', panel: true, panelColour: '#ffdb00' }),
      confirmedBy(['#0058a3', '#ffdb00'])
    )
    expect(next).toMatchObject({ band: 'brand', bandShape: 'panel', support: '#ffdb00' })
  })

  it('an inset card, and art along the foot (Monzo, Harbor)', () => {
    const look = { ...DIRECTIONS_EXAMPLE, accent: '#ff4f40' }
    expect(
      withHero(look, hero({ colour: '#112231', card: true }), confirmedBy(['#112231']))
    ).toMatchObject({ band: 'support', support: '#112231', bandShape: 'inset' })
    expect(withHero(look, hero({ fill: 'page', art: 'hills' }), confirmedBy([])).bandArt).toBe(
      'hills'
    )
  })

  it('leaves a colour the screenshot does not show, and a logo, to the look', () => {
    const look = { ...DIRECTIONS_EXAMPLE, accent: '#163300', band: 'brand' as const }
    expect(withHero(look, hero({ colour: '#0081ba' }), confirmedBy(['#9fe870'])).band).toBe('brand')
    expect(withHero(look, null, confirmedBy([]))).toBe(look)
  })
})
