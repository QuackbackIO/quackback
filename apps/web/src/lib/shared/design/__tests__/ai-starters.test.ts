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
