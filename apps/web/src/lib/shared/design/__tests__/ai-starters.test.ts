/**
 * Ask AI's first suggestions fit the portal: Match my brand until a match
 * has run (a logo from onboarding is not a matched brand), then a few next
 * edits the design can take, never a guessed colour.
 */
import { describe, expect, it } from 'vitest'
import { aiStarters, hasMatched, MATCH_STARTER } from '../ai-starters'
import { defaultDesign, type PortalDesign } from '../schema'

const branded = (): PortalDesign => {
  const design = defaultDesign()
  design.brand.light.accent = '#0058a3'
  design.brand.matchedAt = '2026-11-07T12:00:00.000Z'
  return design
}

describe('aiStarters', () => {
  it('offers only Match my brand while the portal wears the house look', () => {
    expect(hasMatched(defaultDesign())).toBe(false)
    expect(aiStarters(defaultDesign())).toEqual([MATCH_STARTER])
  })

  it('keeps offering Match my brand when onboarding gave a logo and colour but no match ran', () => {
    const onboarded = defaultDesign()
    onboarded.brand.logo.mark.light = { key: 'logos/acme.png' }
    onboarded.brand.light.accent = '#0058a3'
    expect(hasMatched(onboarded)).toBe(false)
    expect(aiStarters(onboarded)).toEqual([MATCH_STARTER])
  })

  it('offers next edits after a match, none naming a colour', () => {
    const design = branded()
    design.nav.home.on = true
    const starters = aiStarters(design)
    expect(starters).toEqual(['Try a dark hero', 'Show the roadmap on Home', 'Square corners'])
    expect(starters.join(' ')).not.toMatch(/green|blue|red|colour/i)
  })

  it('leaves out what the design cannot take', () => {
    const design = branded()
    design.mode = 'dark'
    design.shape.corners = 'pill'
    expect(aiStarters(design, { roadmap: false })).toEqual(['Squarer corners'])
    design.nav.home.on = true
    expect(aiStarters(design, { roadmap: false })).toEqual(['Squarer corners'])
    expect(aiStarters(design, { roadmap: true })).toEqual([
      'Show the roadmap on Home',
      'Squarer corners',
    ])
  })
})

describe('aiStarters for the page and the pick', () => {
  it('offers the picked part’s own examples, up to three', () => {
    const starters = aiStarters(branded(), undefined, { page: 'home', selection: 'hero' })
    expect(starters).toEqual([
      'Make the hero louder',
      'Give the hero more room and a dotted pattern',
      'Just the headline up top, no post box there',
    ])
  })

  it('offers a picked Home block’s examples, by its type', () => {
    const design = branded()
    design.pages.home.blocks = [
      { type: 'updates', id: 'updates1', count: 3, grid: { x: 0, y: 0, w: 6, h: 2 } },
    ] as PortalDesign['pages']['home']['blocks']
    expect(aiStarters(design, undefined, { page: 'home', selection: 'block-updates1' })).toEqual([
      'Show just 2 updates',
    ])
    // A block id the design does not hold offers the page's starters.
    expect(aiStarters(design, undefined, { page: 'home', selection: 'block-gone0000' })).toEqual(
      aiStarters(design, undefined, { page: 'home' })
    )
  })

  it('offers a page section’s examples when it is picked', () => {
    expect(aiStarters(branded(), undefined, { page: 'roadmap', selection: 'board' })).toEqual([
      'Lay the roadmap out in columns',
    ])
  })

  it('keeps to the page open when nothing is picked', () => {
    const design = branded()
    design.nav.home.on = true
    const roadmap = aiStarters(design, undefined, { page: 'roadmap', selection: null })
    expect(roadmap[0]).toBe('Lay the roadmap out in columns')
    expect(roadmap).not.toContain('Show the roadmap on Home')
    expect(roadmap.length).toBeLessThanOrEqual(3)
    const help = aiStarters(design, undefined, { page: 'help' })
    expect(help).toEqual([
      'List the help topics instead of cards',
      'Bring back popular articles on the help center',
      'Give the help center’s search box its usual size',
    ])
    expect(aiStarters(design, undefined, { page: 'home' })).toEqual(aiStarters(design))
  })

  it('falls back to the page’s starters for a pick with no examples', () => {
    const design = branded()
    expect(aiStarters(design, undefined, { page: 'feedback', selection: 'filters' })).toEqual(
      aiStarters(design, undefined, { page: 'feedback' })
    )
    expect(aiStarters(design, undefined, { page: 'feedback' })).not.toContain(
      'Show the roadmap on Home'
    )
  })

  it('offers only Match my brand before a match, whatever is picked', () => {
    expect(aiStarters(defaultDesign(), undefined, { page: 'roadmap', selection: 'board' })).toEqual(
      [MATCH_STARTER]
    )
  })
})
