import { describe, expect, it } from 'vitest'
import { defaultDesign, type PortalDesign } from '../schema'
import type { PortalPageGates } from '../paths'
import { addMenuLink, landingOf, menuParts } from '../menu'
import {
  addLinkStep,
  clickMenu,
  goTarget,
  isMenuTarget,
  landingStep,
  menuStep,
  renameStep,
} from '../menu-actions'

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

const homeOn = () =>
  design((draft) => {
    draft.nav.home = { on: true, tab: true }
  })

/** Applies a step to a copy, as the draft's update does. */
function apply(start: PortalDesign, step: { change: (draft: PortalDesign) => void } | null) {
  const next = structuredClone(start)
  step?.change(next)
  return next
}

const labels = (start: PortalDesign) => menuParts(start, gates).map((part) => part.label)
const actions = (menu: ReturnType<typeof clickMenu>) => menu?.entries.map((each) => each.action)

describe('what the frame may name as a menu item', () => {
  it('takes Home, the pages, links, the logo and sign in', () => {
    for (const each of ['home', 'feedback', 'status', 'link:abc', 'logo', 'sign-in'])
      expect(isMenuTarget(each)).toBe(true)
  })

  it('refuses anything else', () => {
    for (const each of [null, 1, '', 'header', 'link:', 'page:home', 'admin'])
      expect(isMenuTarget(each)).toBe(false)
  })
})

describe('a menu item click menu', () => {
  it('leads with Go to the page, then the changes a page can take', () => {
    const menu = clickMenu(homeOn(), gates, 'changelog')
    expect(actions(menu)).toEqual(['go', 'rename', 'land', 'hide', 'left', 'right'])
    expect(menu!.entries[0]).toMatchObject({ label: 'Go to Changelog', hint: 'Enter' })
    expect(menu!.entries.find((each) => each.action === 'rename')?.hint).toBe('Double-click')
    const hide = menu!.entries.find((each) => each.action === 'hide')
    expect(hide).toMatchObject({ label: 'Hide' })
    expect(hide?.hint).toBeUndefined()
    expect(menu!.entries.find((each) => each.action === 'land')?.label).toBe(
      'Make it the landing page'
    )
  })

  it('says what a renamed page is', () => {
    const renamed = design((draft) => {
      draft.nav.home = { on: true, tab: true }
      const item = draft.nav.items.find((each) => each.type === 'changelog')!
      if ('shown' in item) item.label = 'What is new'
    })
    const menu = clickMenu(renamed, gates, 'changelog')
    expect(menu!.title).toBe('Your changelog, called "What is new" in your menu')
    expect(menu!.entries[0]!.label).toBe('Go to What is new')
  })

  it('leaves out landing for the page visitors already land on, and keeps it in the menu', () => {
    const start = design()
    expect(landingOf(start, gates)).toBe('feedback')
    const menu = clickMenu(start, gates, 'feedback')
    expect(actions(menu)).not.toContain('land')
    expect(menu!.entries.find((each) => each.action === 'hide')).toMatchObject({
      disabled: true,
      hint: 'Landing page',
    })
  })

  it('cannot move the first item left or the last one right', () => {
    const start = design()
    const first = clickMenu(start, gates, 'feedback')!
    const last = clickMenu(start, gates, 'help')!
    expect(first.entries.find((each) => each.action === 'left')?.disabled).toBe(true)
    expect(first.entries.find((each) => each.action === 'right')?.disabled).toBeFalsy()
    expect(last.entries.find((each) => each.action === 'right')?.disabled).toBe(true)
  })

  it('never moves Home, which is always first', () => {
    expect(actions(clickMenu(homeOn(), gates, 'home'))).toEqual(['go', 'rename', 'hide'])
  })

  it('offers a link its address, a new name, a place and removal', () => {
    let id = ''
    const start = design((draft) => {
      id = addMenuLink(draft, { label: 'Blog', url: 'https://example.com/blog' })
    })
    const menu = clickMenu(start, gates, `link:${id}`)
    expect(actions(menu)).toEqual(['edit-link', 'rename', 'left', 'right', 'remove'])
    expect(menu!.title).toBe('A link to example.com')
  })

  it('takes the logo to where visitors land', () => {
    expect(clickMenu(homeOn(), gates, 'logo')).toEqual({
      title: null,
      entries: [{ action: 'go', label: 'Go to Home', hint: 'Enter' }],
    })
    expect(clickMenu(design(), gates, 'logo')!.entries[0]!.label).toBe('Go to Feedback')
  })

  it('leads sign in to its settings', () => {
    const menu = clickMenu(design(), gates, 'sign-in')!
    expect(menu.title).toBe('Visitors sign in here')
    expect(actions(menu)).toEqual(['sign-in-settings'])
  })

  it('has nothing for an item the menu no longer has', () => {
    expect(clickMenu(design(), gates, 'link:gone')).toBeNull()
    expect(clickMenu(design(), gates, 'home')).toBeNull()
  })
})

describe('where Go to goes', () => {
  it('goes to a page or Home, and from the logo to where visitors land', () => {
    expect(goTarget(design(), gates, 'roadmap')).toBe('roadmap')
    expect(goTarget(homeOn(), gates, 'home')).toBe('home')
    expect(goTarget(homeOn(), gates, 'logo')).toBe('home')
    expect(goTarget(design(), gates, 'logo')).toBe('feedback')
    expect(goTarget(design(), gates, 'link:x')).toBeNull()
    expect(goTarget(design(), gates, 'sign-in')).toBeNull()
  })
})

describe('menu steps, each named for undo', () => {
  it('hides a page and shows it again', () => {
    const start = homeOn()
    const hide = menuStep(start, gates, 'roadmap', 'hide')!
    expect(hide.label).toBe('Hide Roadmap')
    const hidden = apply(start, hide)
    expect(menuParts(hidden, gates).find((part) => part.id === 'roadmap')?.shown).toBe(false)
    const show = menuStep(hidden, gates, 'roadmap', 'show')!
    expect(show.label).toBe('Show Roadmap')
    expect(menuParts(apply(hidden, show), gates).find((part) => part.id === 'roadmap')?.shown).toBe(
      true
    )
  })

  it('will not hide the page visitors land on while Home is off', () => {
    expect(menuStep(design(), gates, 'feedback', 'hide')).toBeNull()
  })

  it('makes a page the first visitors see', () => {
    const start = homeOn()
    const step = menuStep(start, gates, 'changelog', 'land')!
    expect(step.label).toBe('Changelog as the landing page')
    const after = apply(start, step)
    expect(landingOf(after, gates)).toBe('changelog')
    expect(labels(after)[0]).toBe('Changelog')
  })

  it('moves a part left or right, and up or down from the panel', () => {
    const start = design()
    const right = menuStep(start, gates, 'feedback', 'right')!
    expect(right.label).toBe('Move Feedback right')
    expect(labels(apply(start, right)).slice(0, 2)).toEqual(['Roadmap', 'Feedback'])
    const up = menuStep(start, gates, 'roadmap', 'up')!
    expect(up.label).toBe('Move Roadmap up')
    expect(labels(apply(start, up)).slice(0, 2)).toEqual(['Roadmap', 'Feedback'])
  })

  it('does not move past either end', () => {
    expect(menuStep(design(), gates, 'feedback', 'left')).toBeNull()
    expect(menuStep(design(), gates, 'help', 'right')).toBeNull()
    expect(menuStep(homeOn(), gates, 'home', 'right')).toBeNull()
  })

  it('removes a link', () => {
    let id = ''
    const start = design((draft) => {
      id = addMenuLink(draft, { label: 'Blog', url: 'https://example.com' })
    })
    const step = menuStep(start, gates, `link:${id}`, 'remove')!
    expect(step.label).toBe('Remove the Blog link')
    expect(labels(apply(start, step))).not.toContain('Blog')
  })

  it('adds a link, named for it', () => {
    const step = addLinkStep({ label: ' Blog ', url: 'https://example.com' })
    expect(step.label).toBe('Add the Blog link')
    const after = apply(design(), step)
    expect(labels(after).at(-1)).toBe('Blog')
  })
})

describe('renaming in place', () => {
  it('renames, named from the old name to the new', () => {
    const start = homeOn()
    const step = renameStep(start, gates, 'changelog', '  What is new ')!
    expect(step.label).toBe('Rename Changelog to What is new')
    expect(labels(apply(start, step))).toContain('What is new')
  })

  it('gives a page back its own name when emptied', () => {
    const start = design((draft) => {
      const item = draft.nav.items.find((each) => each.type === 'changelog')!
      if ('shown' in item) item.label = 'What is new'
    })
    const step = renameStep(start, gates, 'changelog', '   ')!
    expect(step.label).toBe('Rename What is new to Changelog')
    const after = apply(start, step)
    expect(after.nav.items.find((each) => each.type === 'changelog')).not.toHaveProperty('label')
  })

  it('gives Home back its own name when emptied', () => {
    const start = design((draft) => {
      draft.nav.home = { on: true, tab: true, label: 'Start' }
    })
    expect(renameStep(start, gates, 'home', '')!.label).toBe('Rename Start to Home')
  })

  it('changes nothing for the same name, and keeps a link its name when emptied', () => {
    let id = ''
    const start = design((draft) => {
      id = addMenuLink(draft, { label: 'Blog', url: 'https://example.com' })
    })
    expect(renameStep(start, gates, 'roadmap', 'Roadmap')).toBeNull()
    expect(renameStep(start, gates, `link:${id}`, ' ')).toBeNull()
    expect(renameStep(start, gates, `link:${id}`, 'News')!.label).toBe('Rename Blog to News')
  })

  it('keeps a name to 40 characters', () => {
    const long = 'x'.repeat(60)
    const step = renameStep(design(), gates, 'roadmap', long)!
    expect(step.label).toBe(`Rename Roadmap to ${'x'.repeat(40)}`)
  })
})

describe('where visitors land, from the header panel', () => {
  it('turns Home on to land there, named for it', () => {
    const start = design()
    const step = landingStep(start, gates, 'home')!
    expect(step.label).toBe('Home as the landing page')
    expect(landingOf(apply(start, step), gates)).toBe('home')
  })

  it('lands on a page, and changes nothing where visitors already land', () => {
    const start = homeOn()
    expect(landingStep(start, gates, 'roadmap')!.label).toBe('Roadmap as the landing page')
    expect(landingStep(start, gates, 'home')).toBeNull()
  })
})
