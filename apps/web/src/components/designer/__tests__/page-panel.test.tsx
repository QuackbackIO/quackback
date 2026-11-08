// @vitest-environment happy-dom
/**
 * The page's own panel, shown with nothing picked: where the title sits, the
 * background and width, the page's parts as a tree that picks, hides and
 * moves them, and the way to Theme.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { insertHomeBlock } from '@/lib/shared/design/home'
import { outlineOf, type DesignerPage } from '@/lib/shared/design/outline'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { PagePanel } from '../page-panel'

vi.mock('../page-background-settings', () => ({
  PageBackgroundSection: () => <p>Background settings</p>,
}))

afterEach(cleanup)

function show(
  page: DesignerPage,
  change?: (draft: PortalDesign) => void,
  extra: Partial<Parameters<typeof PagePanel>[0]> = {}
) {
  const start = defaultDesign()
  change?.(start)
  const seen = { design: start, labels: [] as Array<string | undefined> }
  const said: string[] = []
  const onSelect = vi.fn()
  const onTheme = vi.fn()
  function Harness() {
    const [design, setDesign] = useState(start)
    return (
      <PagePanel
        crumbs={[{ label: 'Roadmap' }]}
        title="Roadmap"
        page={page}
        design={design}
        nodes={outlineOf(design, page)}
        update={(fn, label) => {
          const next = structuredClone(seen.design)
          fn(next)
          seen.design = next
          seen.labels.push(label)
          setDesign(next)
        }}
        onSelect={onSelect}
        onTheme={onTheme}
        say={(words) => said.push(words)}
        {...extra}
      />
    )
  }
  render(<Harness />)
  return { seen, said, onSelect, onTheme }
}

describe('PagePanel', () => {
  it('puts the title in the hero and back, with a dot and Reset while it is set', () => {
    const { seen } = show('roadmap')
    const title = screen.getByRole('radiogroup', { name: 'Title' })
    expect(document.querySelector('[data-set-dot]')).toBeNull()
    fireEvent.click(within(title).getByRole('radio', { name: 'In the hero' }))
    expect(seen.design.layout.pageTitles).toBe('band')
    expect(document.querySelector('[data-set-dot]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Reset title/ }))
    expect(seen.design.layout.pageTitles).toBeUndefined()
    expect(seen.labels).toEqual(['Page titles', 'Page titles'])
  })

  it('has no title row on a page whose title is always in the hero', () => {
    show('feedback')
    expect(screen.queryByRole('radiogroup', { name: 'Title' })).toBeNull()
  })

  it('says whose background the page shows, and opens its settings in place', () => {
    show('roadmap')
    const row = screen.getByRole('button', { name: 'Background' })
    expect(row.textContent).toBe('Every page: Page colour')
    expect(screen.queryByText('Background settings')).toBeNull()
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Background settings')).toBeTruthy()
  })

  it('shows the page width as the brand’s, opening Theme at its styles', () => {
    const { onTheme } = show('roadmap', (draft) => void (draft.layout.width = 'wide'))
    fireEvent.click(screen.getByRole('button', { name: 'Brand: Wide' }))
    expect(onTheme).toHaveBeenCalledWith(true)
  })

  it('shows the page’s parts as a tree, each picking itself, and leads to Theme', () => {
    const { onSelect, onTheme } = show('roadmap')
    const tree = screen.getByRole('tree', { name: 'On this page' })
    expect(
      within(tree)
        .getAllByRole('treeitem')
        .filter((item) => item.getAttribute('aria-level') === '1')
        .map((item) => document.getElementById(item.getAttribute('aria-labelledby')!)?.textContent)
    ).toEqual(['Header and menu', 'Hero', 'Board'])
    fireEvent.keyDown(within(tree).getByRole('treeitem', { name: 'Board' }), { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('board')
    expect(screen.queryByRole('button', { name: 'Words' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    expect(onTheme).toHaveBeenCalledWith(false)
  })

  it('hides a part from its eye, by its own show field, as one named step', () => {
    const { seen } = show('feedback')
    fireEvent.click(screen.getByRole('button', { name: 'Show Welcome message' }))
    expect(seen.design.pages.feedback.welcome.show).toBe(true)
    expect(seen.labels).toEqual(['Show Welcome message'])
    expect(screen.getByRole('button', { name: 'Hide Welcome message' })).toBeTruthy()
  })

  it('moves a Home block from the tree, saying where it went', () => {
    const { seen, said } = show('home', (draft) => {
      draft.nav.home.on = true
      insertHomeBlock(draft, 'ideas')
      insertHomeBlock(draft, 'roadmap')
    })
    const first = seen.design.pages.home.blocks[0]!.id
    const row = screen.getByRole('treeitem', { name: 'Top posts' })
    fireEvent.keyDown(row, { key: 'ArrowDown', altKey: true })
    expect(seen.design.pages.home.blocks[1]!.id).toBe(first)
    expect(seen.labels).toEqual(['Move block'])
    expect(said).toEqual(['Top posts moved to place 2 of 2.'])
  })

  it('hands a picked row to onPick when given, with its element part', () => {
    const onPick = vi.fn()
    show('roadmap', undefined, { onPick })
    const tree = screen.getByRole('tree', { name: 'On this page' })
    fireEvent.keyDown(within(tree).getByRole('treeitem', { name: 'Headline' }), { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'hero', part: 'hero.roadmap.headline' })
    )
  })

  it('places the changelog’s Subscribe as a page choice', () => {
    const { seen } = show('changelog')
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Subscribe' })).getByRole('radio', {
        name: 'Under',
      })
    )
    expect(seen.design.pages.changelog).toEqual({ subscribe: 'under' })
  })
})
