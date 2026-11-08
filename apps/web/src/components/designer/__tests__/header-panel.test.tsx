// @vitest-environment happy-dom
/**
 * The header's panel on the properties frame: its layout (with the blend
 * into the hero), the menu as rows with Hide or Show on each and the rest
 * under ⋯, the landing page as tiles, the menu's style, and the logo's way
 * to Theme. Names change where the menu draws them, never in the list.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { addMenuLink } from '@/lib/shared/design/menu'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { HeaderPanel } from '../header-panel'

vi.mock('@/lib/client/builder-events', () => ({ trackBuilder: vi.fn() }))

afterEach(cleanup)

const gates: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: false,
  support: false,
  status: false,
}

function show(change?: (draft: PortalDesign) => void) {
  const start = defaultDesign()
  start.nav.home = { on: true, tab: true }
  change?.(start)
  const seen = { design: start, labels: [] as Array<string | undefined> }
  const props = {
    act: vi.fn(),
    onAdd: vi.fn(),
    onTheme: vi.fn(),
    onLanding: vi.fn(),
  }
  function Harness() {
    const [design, setDesign] = useState(start)
    return (
      <HeaderPanel
        crumbs={[{ label: 'Home' }, { label: 'Header and menu' }]}
        pages={5}
        design={design}
        gates={gates}
        update={(fn, label) => {
          const next = structuredClone(seen.design)
          fn(next)
          seen.design = next
          seen.labels.push(label)
          setDesign(next)
        }}
        {...props}
      />
    )
  }
  render(<Harness />)
  return { ...props, seen }
}

const openActions = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }))

const hideRoadmap = (draft: PortalDesign) => {
  const roadmap = draft.nav.items.find((each) => each.type === 'roadmap')!
  if ('shown' in roadmap) roadmap.shown = false
}

describe('HeaderPanel', () => {
  it('sits on the frame, saying it changes the header on every page', () => {
    show()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Header and menu')
    expect(document.querySelector('[data-reach-note]')?.textContent).toBe(
      'Applies to the header (5 pages)'
    )
  })

  it('lists the menu in order, tagging what is hidden and the landing page', () => {
    show(hideRoadmap)
    const list = screen.getByRole('list', { name: 'Menu' })
    expect([...list.querySelectorAll('li')].map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^HomeLanding page/),
      expect.stringContaining('Feedback'),
      expect.stringMatching(/Roadmap.*Hidden/),
      expect.stringContaining('Changelog'),
    ])
  })

  it('hides and shows an item from its row', () => {
    const { act } = show(hideRoadmap)
    fireEvent.click(screen.getByRole('button', { name: 'Hide Feedback' }))
    expect(act).toHaveBeenCalledWith('feedback', 'hide', 'panel')
    fireEvent.click(screen.getByRole('button', { name: 'Show Roadmap' }))
    expect(act).toHaveBeenCalledWith('roadmap', 'show', 'panel')
  })

  it('takes the rest from ⋯, moving left and right as the menu runs', async () => {
    const { act } = show()
    openActions('Roadmap')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Go to Roadmap/ }))
    expect(act).toHaveBeenCalledWith('roadmap', 'go', 'panel')
    openActions('Roadmap')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Move left/ }))
    expect(act).toHaveBeenCalledWith('roadmap', 'left', 'panel')
    openActions('Roadmap')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Make it the landing page/ }))
    expect(act).toHaveBeenCalledWith('roadmap', 'land', 'panel')
    openActions('Roadmap')
    expect(screen.queryByRole('menuitem', { name: /Move up|Move down/ })).toBeNull()
  })

  it('renames where the menu draws the item, never in the list', async () => {
    const { act } = show()
    openActions('Changelog')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Rename/ }))
    expect(act).toHaveBeenCalledWith('changelog', 'rename', 'panel')
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Feedback' }))
    expect(act).toHaveBeenCalledWith('feedback', 'rename', 'panel')
  })

  it('opens a link’s settings from its row', () => {
    const { act } = show((draft) => {
      addMenuLink(draft, { label: 'Docs', url: 'https://example.com' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Docs' }))
    expect(act).toHaveBeenCalledWith(expect.stringMatching(/^link:/), 'edit-link', 'panel')
  })

  it('picks the landing page from tiles', () => {
    const { onLanding } = show()
    const tiles = screen.getByRole('radiogroup', { name: 'Landing page' })
    expect(within(tiles).getByRole('radio', { name: 'Home' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    fireEvent.click(within(tiles).getByRole('radio', { name: 'Roadmap' }))
    expect(onLanding).toHaveBeenCalledWith('roadmap')
  })

  it('sets the layout and blends the header into the hero, each named for undo', () => {
    const { seen } = show((draft) => void (draft.layout.band = 'brand'))
    fireEvent.click(screen.getByRole('radio', { name: 'Inline' }))
    expect(seen.design.layout.header).toBe('inline')
    fireEvent.click(screen.getByRole('switch', { name: 'Header blends into the hero' }))
    expect(seen.design.layout.headerOnBand).toBe(true)
    fireEvent.click(screen.getByRole('switch', { name: 'Header blends into the hero' }))
    expect(seen.design.layout).not.toHaveProperty('headerOnBand')
    expect(seen.labels).toEqual([
      'Header layout',
      'Header blends into the hero',
      'Header blends into the hero',
    ])
  })

  it('has no blend into a hero that is plain', () => {
    show((draft) => void (draft.layout.band = 'none'))
    expect(screen.queryByRole('switch', { name: 'Header blends into the hero' })).toBeNull()
  })

  it('leads to Theme for the logo, and to adding to the menu', () => {
    const { onTheme, onAdd } = show()
    fireEvent.click(screen.getByRole('button', { name: 'Change the logo in Theme' }))
    expect(onTheme).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add to the menu' }))
    expect(onAdd).toHaveBeenCalled()
  })
})
