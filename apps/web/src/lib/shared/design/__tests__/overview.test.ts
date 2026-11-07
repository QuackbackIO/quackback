import { describe, expect, it } from 'vitest'
import { defaultDesign } from '../schema'
import { HOME_BLOCKS_MAX, newBlock } from '../home'
import { homeSuggestions, landingName } from '../overview'

const gates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: false,
  support: false,
  status: false,
}

const allOn = { ...gates, help: true, support: true, status: true }

function withHome(types: Parameters<typeof newBlock>[0][] = []) {
  const design = defaultDesign()
  design.nav.home.on = true
  design.pages.home.blocks = types.map((type, i) => ({ ...newBlock(type), id: `block${i}` }))
  return design
}

describe('where visitors land', () => {
  it('is Home while Home is on', () => {
    expect(landingName(withHome(), gates)).toBe('Home')
  })

  it('is the first page the menu shows when Home is off, by its menu label', () => {
    const design = defaultDesign()
    design.nav.items = [
      { type: 'feedback', shown: false },
      { type: 'help', shown: true, label: 'Help' },
      { type: 'roadmap', shown: true },
    ]
    expect(landingName(design, allOn)).toBe('Help')
  })

  it('skips a page whose part is off', () => {
    const design = defaultDesign()
    design.nav.items = [
      { type: 'help', shown: true },
      { type: 'roadmap', shown: true },
    ]
    expect(landingName(design, gates)).toBe('Roadmap')
  })
})

describe('what Add suggests', () => {
  const ids = (design: ReturnType<typeof defaultDesign>, on = allOn) =>
    homeSuggestions(design, on).map((each) => each.id)

  it('suggests a Home block for each part that is on and missing from Home', () => {
    expect(ids(withHome(['ideas']))).toEqual(['help', 'contact', 'status'])
  })

  it('suggests nothing for a part that is off', () => {
    expect(ids(withHome(['ideas']), gates)).toEqual(['updates'])
  })

  it('suggests nothing for a part Home already shows', () => {
    expect(ids(withHome(['help_topics', 'contact', 'status', 'updates']))).toEqual([])
  })

  it('suggests no blocks while Home is off or full', () => {
    const off = withHome()
    off.nav.home.on = false
    expect(ids(off)).toEqual([])
    const full = withHome(Array.from({ length: HOME_BLOCKS_MAX }, () => 'links' as const))
    expect(ids(full)).toEqual([])
  })

  it('names the block each suggestion adds', () => {
    const [help] = homeSuggestions(withHome(), allOn)
    expect(help).toMatchObject({ id: 'help', type: 'help_search', label: 'Add help search' })
  })

  it('leads with a part that is new', () => {
    const [first] = homeSuggestions(withHome(['ideas']), allOn, ['status'])
    expect(first).toMatchObject({ id: 'status', type: 'status' })
    expect(first?.text).toMatch(/^Status is new\./)
  })
})
