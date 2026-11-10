import { describe, expect, it } from 'vitest'
import { defaultDesign, portalDesignV2, type PortalDesign } from '../schema'
import { newBlock } from '../home'
import { portalLanding, PAGE_PATHS, type PortalPageGates } from '../paths'
import {
  addMenuLink,
  hiddenNote,
  isMenuSelection,
  landingOf,
  landingOptions,
  leadingPart,
  menuParts,
  moveMenuPart,
  newParts,
  offParts,
  removeHomeBlocksOf,
  renameMenuPart,
  setLanding,
  setMenuShown,
} from '../menu'

const gates: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: false,
  status: false,
}

function design(change?: (draft: PortalDesign) => void) {
  const draft = defaultDesign()
  change?.(draft)
  return draft
}

const ids = (draft: PortalDesign) => menuParts(draft, gates).map((part) => part.id)

describe('the menu as parts', () => {
  it('lists Home first while it is on, then the parts that are on, in menu order', () => {
    const draft = design((d) => {
      d.nav.home.on = true
      d.nav.items = [
        { type: 'help', shown: true },
        { type: 'support', shown: true },
        { type: 'feedback', shown: false },
        { type: 'link', id: 'docs', label: 'Docs', url: 'https://example.com', newTab: true },
      ]
    })
    // Support is off; Roadmap and Changelog are missing, so they come last as the portal shows them.
    expect(ids(draft)).toEqual(['home', 'help', 'feedback', 'link:docs', 'roadmap', 'changelog'])
  })

  it('leaves Home out while it is off', () => {
    expect(ids(design())).toEqual(['feedback', 'roadmap', 'changelog', 'help'])
  })

  it('names each by the visitor label and, where it differs, the admin name', () => {
    const draft = design((d) => {
      d.nav.items[3] = { type: 'help', shown: true, label: 'Help' }
    })
    const parts = menuParts(draft, gates)
    expect(parts.find((part) => part.id === 'help')).toMatchObject({
      label: 'Help',
      adminName: 'Help Center',
    })
    expect(parts.find((part) => part.id === 'changelog')).toMatchObject({
      label: 'Changelog',
      adminName: null,
    })
  })

  it('says which part visitors land on', () => {
    const parts = menuParts(design(), gates)
    expect(parts.filter((part) => part.lands).map((part) => part.id)).toEqual(['feedback'])
  })
})

describe('where visitors land', () => {
  const cases: Array<[string, (d: PortalDesign) => void]> = [
    ['Home on', (d) => void (d.nav.home.on = true)],
    ['Feedback first', () => {}],
    [
      'Help first',
      (d) => {
        d.nav.items.unshift(d.nav.items.splice(3, 1)[0]!)
      },
    ],
    ['first hidden', (d) => void (d.nav.items[0] = { type: 'feedback', shown: false })],
  ]
  it.each(cases)('agrees with what / shows: %s', (_, change) => {
    const draft = design(change)
    const landing = portalLanding({ engine: 'v2', nav: draft.nav }, gates)
    const to = landing.kind === 'home' ? 'home' : landing.kind === 'feed' ? 'feedback' : landing.to
    const at = landingOf(draft, gates)
    expect(at === 'home' || at === 'feedback' ? at : PAGE_PATHS[at]).toBe(to)
  })

  it('offers Home and each part that is on', () => {
    expect(landingOptions(design(), gates)).toEqual([
      'home',
      'feedback',
      'roadmap',
      'changelog',
      'help',
    ])
  })

  it('landing on a page moves it to the top of the menu, shows it and turns Home off', () => {
    const draft = design((d) => {
      d.nav.home.on = true
      d.nav.items[2] = { type: 'changelog', shown: false }
    })
    setLanding(draft, gates, 'changelog')
    expect(draft.nav.home.on).toBe(false)
    expect(draft.nav.items[0]).toEqual({ type: 'changelog', shown: true })
    expect(landingOf(draft, gates)).toBe('changelog')
    expect(portalDesignV2.safeParse(draft).success).toBe(true)
  })

  it('landing on Home turns it on and starts it with blocks when it has none', () => {
    const draft = design()
    setLanding(draft, gates, 'home')
    expect(draft.nav.home.on).toBe(true)
    expect(draft.pages.home.blocks.length).toBeGreaterThan(0)
    expect(landingOf(draft, gates)).toBe('home')
  })

  it('starts Home led by the part first in the menu', () => {
    const draft = design((d) => {
      const help = d.nav.items.findIndex((item) => item.type === 'help')
      const [item] = d.nav.items.splice(help, 1)
      d.nav.items.unshift(item!)
    })
    setLanding(draft, gates, 'home')
    expect(draft.pages.home.blocks.map((block) => block.type).slice(0, 2)).toEqual([
      'welcome',
      'help_topics',
    ])
  })

  it('lets the first part the menu shows lead, passing over a hidden one', () => {
    const draft = design((d) => {
      d.nav.items = [
        { type: 'changelog', shown: false },
        { type: 'roadmap', shown: true },
        { type: 'feedback', shown: true },
      ]
    })
    expect(leadingPart(draft, gates)).toBe('roadmap')
  })

  it('landing on Home keeps the blocks it has', () => {
    const draft = design((d) => void (d.pages.home.blocks = [newBlock('links')]))
    setLanding(draft, gates, 'home')
    expect(draft.pages.home.blocks.map((block) => block.type)).toEqual(['links'])
  })

  it('landing on a part missing from the stored menu adds it first', () => {
    const draft = design((d) => void (d.nav.items = [{ type: 'feedback', shown: true }]))
    setLanding(draft, gates, 'help')
    expect(draft.nav.items[0]).toEqual({ type: 'help', shown: true })
    expect(landingOf(draft, gates)).toBe('help')
  })
})

describe('showing and hiding', () => {
  it('hides a page from the menu', () => {
    const draft = design()
    expect(setMenuShown(draft, gates, 'roadmap', false)).toBe(true)
    expect(draft.nav.items.find((item) => item.type === 'roadmap')).toMatchObject({
      shown: false,
    })
  })

  it('takes Home out of the menu without turning it off', () => {
    const draft = design((d) => {
      d.nav.home.on = true
      d.nav.home.tab = true
    })
    setMenuShown(draft, gates, 'home', false)
    expect(draft.nav.home).toMatchObject({ on: true, tab: false })
  })

  it('keeps the page visitors land on in the menu while Home is off', () => {
    const draft = design()
    expect(setMenuShown(draft, gates, 'feedback', false)).toBe(false)
    expect(draft.nav.items[0]).toMatchObject({ shown: true })
  })

  it('says a hidden page stays open at its address', () => {
    const draft = design((d) => void (d.nav.items[1] = { type: 'roadmap', shown: false }))
    expect(hiddenNote(draft, gates, 'roadmap')).toEqual({ path: '/roadmap', blocks: [] })
    expect(hiddenNote(draft, gates, 'changelog')).toBeNull()
  })

  it('says when Home still shows the hidden part, and the blocks can go', () => {
    const draft = design((d) => {
      d.nav.home.on = true
      d.nav.items[1] = { type: 'roadmap', shown: false }
      d.pages.home.blocks = [
        { ...newBlock('welcome'), id: 'w' },
        { ...newBlock('roadmap'), id: 'r' },
      ]
    })
    expect(hiddenNote(draft, gates, 'roadmap')).toEqual({ path: '/roadmap', blocks: ['r'] })
    removeHomeBlocksOf(draft, 'roadmap')
    expect(draft.pages.home.blocks.map((block) => block.id)).toEqual(['w'])
  })

  it('does not count blocks while Home is off', () => {
    const draft = design((d) => {
      d.nav.items[1] = { type: 'roadmap', shown: false }
      d.pages.home.blocks = [{ ...newBlock('roadmap'), id: 'r' }]
    })
    expect(hiddenNote(draft, gates, 'roadmap')?.blocks).toEqual([])
  })
})

describe('moving and renaming', () => {
  it('moves a part to a place among the parts that can move', () => {
    const draft = design((d) => void (d.nav.home.on = true))
    moveMenuPart(draft, gates, 'help', 0)
    expect(ids(draft)).toEqual(['home', 'help', 'feedback', 'roadmap', 'changelog'])
  })

  it('keeps parts that are off where they were', () => {
    const draft = design()
    moveMenuPart(draft, gates, 'feedback', 3)
    expect(draft.nav.items.map((item) => item.type)).toEqual([
      'roadmap',
      'changelog',
      'help',
      'feedback',
      'support',
      'status',
    ])
  })

  it('renames a page, and an empty name gives it back its own', () => {
    const draft = design()
    renameMenuPart(draft, 'changelog', ' What is new ')
    expect(draft.nav.items[2]).toEqual({ type: 'changelog', shown: true, label: 'What is new' })
    renameMenuPart(draft, 'changelog', '  ')
    expect(draft.nav.items[2]).toEqual({ type: 'changelog', shown: true })
  })

  it('renames Home', () => {
    const draft = design((d) => void (d.nav.home.on = true))
    renameMenuPart(draft, 'home', 'Start')
    expect(draft.nav.home.label).toBe('Start')
  })

  it('adds a link last, and a link keeps a name', () => {
    const draft = design()
    const id = addMenuLink(draft, { label: 'Docs', url: 'https://example.com/docs' })
    expect(draft.nav.items.at(-1)).toEqual({
      type: 'link',
      id,
      label: 'Docs',
      url: 'https://example.com/docs',
      newTab: true,
    })
    renameMenuPart(draft, `link:${id}`, ' ')
    expect(draft.nav.items.at(-1)).toMatchObject({ label: 'Docs' })
    expect(portalDesignV2.safeParse(draft).success).toBe(true)
  })

  it('knows a menu part when it sees one', () => {
    expect(isMenuSelection('page:help')).toBe(true)
    expect(isMenuSelection('link:abc')).toBe(true)
    expect(isMenuSelection('header')).toBe(false)
  })
})

describe('parts that are off', () => {
  it('lists only the parts that are off, each with where it is turned on', () => {
    const off = offParts(gates, { featureFlags: { supportTickets: false } })
    expect(off.map((part) => part.type)).toEqual(['support', 'status'])
    expect(off.every((part) => part.href.startsWith('/admin/settings/'))).toBe(true)
    expect(off.every((part) => part.does.length > 0)).toBe(true)
  })

  it('lists nothing when every part is on', () => {
    const all = { ...gates, support: true, status: true }
    expect(offParts(all, {})).toEqual([])
  })

  it('sends a published-page switch to its own settings, a module to the module list', () => {
    const flags = { statusPage: true }
    const status = offParts(gates, {
      featureFlags: flags,
      statusConfig: { enabled: false },
    }).find((part) => part.type === 'status')
    expect(status?.href).toBe('/admin/settings/status')
    const off = offParts(gates, { featureFlags: {} }).find((part) => part.type === 'status')
    expect(off?.href).toBe('/admin/settings/general')
  })
})

describe('parts that are new', () => {
  it('is nothing the first time the builder opens', () => {
    expect(newParts(null, gates)).toEqual([])
  })

  it('is each part on now that was not on last time', () => {
    expect(newParts(['feedback', 'roadmap', 'changelog'], gates)).toEqual(['help'])
  })
})
