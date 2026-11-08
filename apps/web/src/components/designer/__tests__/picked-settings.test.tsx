// @vitest-environment happy-dom
/**
 * The right panel as the route table says: never blank, each panel with its
 * breadcrumb, whose crumbs go up a level; and the page's other parts on the
 * properties frame, the feed's sort for this page apart from how every post
 * card looks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { newBlock } from '@/lib/shared/design/home'
import { addMenuLink } from '@/lib/shared/design/menu'
import { outlineOf, type DesignerPage, type Selection } from '@/lib/shared/design/outline'
import { panelFor } from '@/lib/shared/design/panel-routes'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { defaultDesign } from '@/lib/shared/design/schema'
import { PickedSettings } from '../picked-settings'

vi.mock('@/lib/client/builder-events', () => ({ trackBuilder: vi.fn() }))
vi.mock('../hero-panel', () => ({
  // The hero's panel draws the route's breadcrumb on its own frame.
  HeroPanel: ({ crumbs }: { crumbs: Array<{ label: string; onSelect?: () => void }> }) => (
    <p>
      Hero settings: {crumbs.map((crumb) => crumb.label).join(' / ')}
      <button type="button" onClick={crumbs[0]!.onSelect}>
        Up
      </button>
    </p>
  ),
}))
vi.mock('../picked-block', () => ({ PickedBlock: () => <p>Block settings</p> }))
vi.mock('../page-background-settings', () => ({ PageBackgroundSection: () => null }))
const edits = vi.hoisted(() => [] as string[])
vi.mock('../words/edit-on-canvas', () => ({ editOnCanvas: (field: string) => edits.push(field) }))

afterEach(() => {
  cleanup()
  edits.length = 0
})

const gates: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: false,
  status: false,
}

function show(selection: Selection | null, page: DesignerPage, start = defaultDesign()) {
  const seen = { design: start, labels: [] as Array<string | undefined> }
  const onSelect = vi.fn()
  const menu = { act: vi.fn(), land: vi.fn(), setAdding: vi.fn() }
  function Harness() {
    const [design, setDesign] = useState(start)
    const nodes = outlineOf(design, page)
    return (
      <PickedSettings
        route={panelFor(selection, false, page)}
        selection={selection}
        page={page}
        pages={5}
        nodes={nodes}
        design={design}
        update={(fn, label) => {
          const next = structuredClone(seen.design)
          fn(next)
          seen.design = next
          seen.labels.push(label)
          setDesign(next)
        }}
        gates={gates}
        locale="en"
        menu={menu}
        onSelect={onSelect}
        onTheme={vi.fn()}
        say={vi.fn()}
      />
    )
  }
  render(<Harness />)
  return { seen, onSelect, menu }
}

const crumbs = () => screen.getByRole('navigation', { name: 'Where it is' }).textContent

describe('PickedSettings', () => {
  it('shows the page with nothing picked, for the site, and for a pick with no panel', () => {
    for (const pick of [null, 'site', 'nonsense'] as const) {
      show(pick as Selection | null, 'roadmap')
      expect(document.querySelector('[data-page-panel]'), String(pick)).not.toBeNull()
      cleanup()
    }
  })

  it('puts the header under the page, whose crumb goes up to it', () => {
    const { onSelect } = show('header', 'roadmap')
    expect(crumbs()).toBe('RoadmapHeader and menu')
    const nav = screen.getByRole('navigation', { name: 'Where it is' })
    fireEvent.click(within(nav).getByRole('button', { name: 'Roadmap' }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('puts a menu link under the header, and goes up to it once the link is removed', () => {
    const design = defaultDesign()
    const id = addMenuLink(design, { label: 'Docs', url: 'https://example.com' })
    const { onSelect } = show(`link:${id}` as Selection, 'feedback', design)
    expect(crumbs()).toBe('FeedbackHeader and menuDocs')
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }))
    expect(onSelect).toHaveBeenCalledWith('header')
  })

  it('hands the hero its breadcrumb, with nothing drawn above its panel', () => {
    const { onSelect } = show('hero', 'help')
    expect(screen.getByText(/Hero settings/).textContent).toBe(
      'Hero settings: Help Center / HeroUp'
    )
    expect(screen.queryByRole('navigation', { name: 'Where it is' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Up' }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('has no Words panel: the old address shows the page', () => {
    show('site:words' as Selection, 'home')
    expect(document.querySelector('[data-page-panel]')).not.toBeNull()
    expect(document.querySelector('[data-words-panel]')).toBeNull()
  })

  it('gives the composer its words, each shown in the language viewed and edited on the page', () => {
    const start = defaultDesign()
    start.pages.feedback.copy = { prompt: { en: 'Tell us', fr: 'Dites-nous' } }
    const { seen } = show('composer', 'feedback', start)
    expect(crumbs()).toBe('FeedbackComposer')
    const words = screen.getByRole('region', { name: 'Words' })
    expect(within(words).getByText('Tell us')).toBeTruthy()
    // Without words of its own, the button shows what the page says, in grey.
    expect(within(words).getByText('Post').className).toContain('text-muted-foreground')
    fireEvent.click(within(words).getByRole('button', { name: 'Edit prompt' }))
    fireEvent.click(within(words).getByRole('button', { name: 'Edit button' }))
    expect(edits).toEqual(['feedback.prompt', 'feedback.submit'])
    fireEvent.click(within(words).getByRole('button', { name: "Reset to “What's on your mind?”" }))
    expect(seen.design.pages.feedback.copy.prompt).toEqual({ fr: 'Dites-nous' })
  })

  it('puts the empty feed’s title on the feed, previewed empty to edit it on the page', () => {
    show('feed', 'feedback')
    const empty = screen.getByRole('region', { name: 'When empty' })
    const preview = within(empty).getByRole('switch', { name: 'Preview empty' })
    expect(preview.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(within(empty).getByRole('button', { name: 'Edit title' }))
    expect(edits).toEqual(['feedback.emptyTitle'])
    // Editing the title shows the feed empty, where the title is.
    expect(preview.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(preview)
    expect(preview.getAttribute('aria-checked')).toBe('false')
  })

  it('splits the feed: this page’s sort apart from every post card’s look', () => {
    const { seen } = show('feed', 'feedback')
    const posts = screen.getByRole('region', { name: 'Posts' })
    const cards = screen.getByRole('region', { name: 'Post cards' })
    expect(posts.querySelector('[data-reach-note]')?.textContent).toBe(
      'Applies to the feed on this page'
    )
    expect(cards.querySelector('[data-reach-note]')?.textContent).toBe('Applies to every post card')
    fireEvent.click(within(posts).getByRole('radio', { name: 'New' }))
    expect(seen.design.pages.feedback.defaultSort).toBe('new')
    // Every name in full, as the vocabulary has it.
    expect(within(cards).getByRole('radiogroup', { name: 'Density' }).textContent).toBe(
      'CompactComfortableSpacious'
    )
    fireEvent.click(within(cards).getByRole('radio', { name: 'Rows' }))
    expect(seen.design.layout.cards).toBe('list')
    fireEvent.click(within(cards).getByRole('switch', { name: 'Show tags' }))
    expect(seen.design.layout.postCardHides).toEqual(['tags'])
    expect(seen.labels).toEqual(['Default sort', 'Cards', 'Post cards'])
  })

  it('turns the welcome message off with its words left to the page', () => {
    const design = defaultDesign()
    design.pages.feedback.welcome.show = true
    const { seen } = show('welcome', 'feedback', design)
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Show the welcome message' }))
    expect(seen.design.pages.feedback.welcome.show).toBe(false)
  })

  it('starts Home from a layout, leaving its blocks to the Blocks menu', () => {
    const design = defaultDesign()
    design.nav.home = { on: true, tab: true }
    design.pages.home.blocks = [{ ...newBlock('ideas'), id: 'ideas1' }]
    show('home', 'home', design)
    expect(crumbs()).toBe('HomeBlocks')
    expect(screen.getByRole('region', { name: 'Start from' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Blocks' })).toBeNull()
  })
})
