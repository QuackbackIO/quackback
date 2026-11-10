/**
 * Home's hero has one main action: the composer, the help search, a call to
 * action, or none. Designs stored before the choice keep what they draw: the
 * composer in the band is the Composer, on the grid it is None.
 */
import { describe, expect, it } from 'vitest'
import {
  buttonToOf,
  composerInHero,
  drawnButtonTo,
  drawnMainAction,
  mainActionOf,
  mainActionsOffered,
  writeMainAction,
} from '../main-action'
import { homeGridItems, newBlock } from '../home'
import { DESIGN_OPTIONS } from '../options'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'
import type { PortalPageGates } from '../paths'

const ALL_ON: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

function withComposer(): PortalDesign {
  const design = defaultDesign()
  design.pages.home.blocks = [
    { ...newBlock('composer'), id: 'composer01', grid: { x: 0, y: 0, w: 12, h: 1 } },
    { ...newBlock('ideas'), id: 'ideas0001', grid: { x: 0, y: 1, w: 12, h: 2 } },
  ]
  return design
}

describe('the main action field', () => {
  it('is four choices, the composer first', () => {
    expect(DESIGN_OPTIONS.mainAction).toEqual(['composer', 'search', 'button', 'none'])
    expect(DESIGN_OPTIONS.heroButtonTo).toEqual(['composer', 'roadmap', 'help', 'support'])
  })

  it('is optional on Home, with a call to action’s own settings, and only takes its values', () => {
    const design = defaultDesign()
    expect(portalDesign.parse(design).pages.home.mainAction).toBeUndefined()
    design.pages.home.mainAction = 'button'
    design.pages.home.button = { to: 'roadmap', second: true, label: { en: 'See what is next' } }
    expect(portalDesign.parse(design).pages.home.button?.to).toBe('roadmap')
    const wrong = structuredClone(design) as unknown as { pages: { home: { mainAction: string } } }
    wrong.pages.home.mainAction = 'banner'
    expect(portalDesign.safeParse(wrong).success).toBe(false)
    const long = structuredClone(design)
    long.pages.home.button = { label: { en: 'x'.repeat(41) } }
    expect(portalDesign.safeParse(long).success).toBe(false)
  })
})

describe('mainActionOf', () => {
  it('reads a design from before the choice as what it draws: the band is the Composer, else None', () => {
    const design = withComposer()
    expect(mainActionOf(design.pages.home)).toBe('none')
    design.pages.home.composer = 'band'
    expect(mainActionOf(design.pages.home)).toBe('composer')
  })

  it('reads a stored choice over the composer’s place', () => {
    const design = withComposer()
    design.pages.home.composer = 'band'
    design.pages.home.mainAction = 'search'
    expect(mainActionOf(design.pages.home)).toBe('search')
    expect(composerInHero(design.pages.home)).toBe(false)
  })
})

describe('writeMainAction', () => {
  it('stores the Composer and None as the composer’s place alone, as designs always have', () => {
    const design = withComposer()
    writeMainAction(design, 'composer')
    expect(design.pages.home.composer).toBe('band')
    expect(design.pages.home).not.toHaveProperty('mainAction')
    writeMainAction(design, 'none')
    expect(design.pages.home).not.toHaveProperty('composer')
    expect(design.pages.home).not.toHaveProperty('mainAction')
  })

  it('stores Search and Button, with the composer back on the grid', () => {
    const design = withComposer()
    writeMainAction(design, 'composer')
    writeMainAction(design, 'search')
    expect(design.pages.home.mainAction).toBe('search')
    expect(design.pages.home).not.toHaveProperty('composer')
    expect(homeGridItems(design.pages.home, ALL_ON).map((item) => item.id)).toContain('composer01')
    writeMainAction(design, 'button')
    expect(design.pages.home.mainAction).toBe('button')
    expect(portalDesign.safeParse(design).success).toBe(true)
  })

  it('changes nothing when the action asked for is the one drawn', () => {
    const design = withComposer()
    design.pages.home.composer = 'band'
    design.pages.home.blocks[1]!.grid = { x: 0, y: 3, w: 12, h: 2 }
    const before = structuredClone(design)
    writeMainAction(design, 'composer')
    expect(design).toEqual(before)
  })

  it('takes the composer off the grid only in the hero', () => {
    const design = withComposer()
    writeMainAction(design, 'composer')
    expect(homeGridItems(design.pages.home, ALL_ON).map((item) => item.id)).not.toContain(
      'composer01'
    )
  })

  it('keeps a call to action’s settings when another action is picked, for coming back to it', () => {
    const design = withComposer()
    design.pages.home.button = { to: 'roadmap' }
    writeMainAction(design, 'composer')
    expect(design.pages.home.button).toEqual({ to: 'roadmap' })
  })
})

describe('what Home draws', () => {
  it('draws Search only with the help centre on, else None', () => {
    const design = withComposer()
    design.pages.home.mainAction = 'search'
    expect(drawnMainAction(design.pages.home, ALL_ON)).toBe('search')
    expect(drawnMainAction(design.pages.home, { ...ALL_ON, help: false })).toBe('none')
  })

  it('sends a call to action to the composer unless it goes to an open roadmap', () => {
    const design = withComposer()
    design.pages.home.mainAction = 'button'
    expect(buttonToOf(design.pages.home)).toBe('composer')
    design.pages.home.button = { to: 'roadmap' }
    expect(buttonToOf(design.pages.home)).toBe('roadmap')
    expect(drawnButtonTo(design.pages.home, ALL_ON)).toBe('roadmap')
    expect(drawnButtonTo(design.pages.home, { ...ALL_ON, roadmap: false })).toBe('composer')
  })

  it('goes to help or support while that page is on, else falls back', () => {
    const design = withComposer()
    design.pages.home.button = { to: 'help' }
    expect(drawnButtonTo(design.pages.home, ALL_ON)).toBe('help')
    expect(drawnButtonTo(design.pages.home, { ...ALL_ON, help: false })).toBe('composer')
    design.pages.home.button = { to: 'support' }
    expect(drawnButtonTo(design.pages.home, ALL_ON)).toBe('support')
    expect(drawnButtonTo(design.pages.home, { ...ALL_ON, support: false })).toBe('composer')
  })

  it('draws no call to action with nowhere for it to go', () => {
    const design = withComposer()
    design.pages.home.mainAction = 'button'
    const off = { ...ALL_ON, feedback: false, roadmap: false }
    expect(drawnButtonTo(design.pages.home, off)).toBeNull()
    expect(drawnMainAction(design.pages.home, off)).toBe('none')
  })
})

describe('mainActionsOffered', () => {
  it('offers every choice with every page on', () => {
    expect(mainActionsOffered(ALL_ON)).toEqual({
      actions: ['composer', 'search', 'button', 'none'],
      buttonTo: ['composer', 'roadmap', 'help', 'support'],
      notes: { actions: [], buttonTo: [] },
    })
  })

  it('leaves Search out without the help centre and the roadmap without one, saying why', () => {
    const offered = mainActionsOffered({ ...ALL_ON, help: false, roadmap: false })
    expect(offered.actions).toEqual(['composer', 'button', 'none'])
    expect(offered.buttonTo).toEqual(['composer', 'support'])
    expect(offered.notes).toEqual({
      actions: ['Search needs the help centre on.'],
      buttonTo: [
        'The roadmap needs to be on for a button to go there.',
        'The help centre needs to be on for a button to go there.',
      ],
    })
  })
})
