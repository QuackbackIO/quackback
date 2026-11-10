// @vitest-environment happy-dom
/**
 * Theme and Add are sheets over the right panel: the panel keeps its width
 * and stays mounted underneath, dimmed and out of reach, and the sheet has a
 * close and, with a block picked, a way back to it. Add lists the blocks by
 * job, says which are on Home, and a click adds one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { newBlock } from '@/lib/shared/design/home'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { defaultDesign } from '@/lib/shared/design/schema'

vi.mock('../home-layout-picker', () => ({ HomeLayoutPicker: () => null }))

const { BuilderSheet } = await import('../builder-sheet')
const { RightPanel } = await import('../right-panel')
const { AddContent, addHint } = await import('../add-sheet')

afterEach(cleanup)

const ALL_ON: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

function panel(sheet: boolean, back: string | null = null) {
  const onBack = vi.fn()
  const onClose = vi.fn()
  render(
    <RightPanel
      open
      hidden={false}
      showing="block-topposts"
      sheet={
        sheet && (
          <BuilderSheet
            id="sheet-theme"
            title="Theme"
            back={back}
            onBack={onBack}
            onClose={onClose}
          >
            <p>Brand kit</p>
          </BuilderSheet>
        )
      }
    >
      <button type="button">Top posts settings</button>
    </RightPanel>
  )
  return { onBack, onClose }
}

describe('a sheet over the right panel', () => {
  it('leaves the panel underneath mounted, dimmed and out of reach', () => {
    panel(true)
    const under = document.querySelector('[data-panel-under]')!
    expect(under.hasAttribute('inert')).toBe(true)
    expect(under.className).toContain('opacity-40')
    expect(screen.getByText('Top posts settings')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Theme' })).toBeTruthy()
  })

  it('leaves the panel in reach with no sheet', () => {
    panel(false)
    expect(document.querySelector('[data-panel-under]')!.hasAttribute('inert')).toBe(false)
  })

  it('moves focus to its heading, and closes', () => {
    const { onClose } = panel(true)
    expect(document.activeElement?.textContent).toBe('Theme')
    fireEvent.click(screen.getByRole('button', { name: 'Close Theme' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('crumbs the way back to what the panel under it shows', () => {
    const { onBack } = panel(true, 'Top posts')
    const crumbs = screen.getByRole('navigation', { name: 'Where it is' })
    expect(crumbs.textContent).toBe('Top postsTheme')
    fireEvent.click(within(crumbs).getByRole('button', { name: 'Top posts' }))
    expect(onBack).toHaveBeenCalledOnce()
    cleanup()
    panel(true, null)
    expect(screen.queryByRole('navigation', { name: 'Where it is' })).toBeNull()
  })
})

describe('Add', () => {
  function add(after: string | null = null, onHome = true, homeOn = false) {
    const design = defaultDesign()
    design.nav.home.on = homeOn
    design.pages.home.blocks = [newBlock('ideas'), newBlock('status')]
    const onAdd = vi.fn()
    render(
      <AddContent
        design={design}
        update={vi.fn()}
        gates={ALL_ON}
        after={after}
        onHome={onHome}
        onAdd={onAdd}
      />
    )
    return { onAdd }
  }

  it('groups the blocks by job and says which are on Home', () => {
    add()
    expect(screen.getByRole('heading', { name: 'Feedback' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Hear from customers' })).toBeNull()
    const topPosts = screen.getByRole('button', { name: /Top posts/ })
    expect(topPosts.querySelector('[data-card-tag]')?.textContent).toBe('On Home')
    // Home holds Status once.
    expect((screen.getByRole('button', { name: /^Status/ }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('keeps each card to its name and purpose, with Needs and Turn on under them', () => {
    add()
    const cards = [...document.querySelectorAll('[data-add-card]')]
    // The status is one word on its own, never wrapped into the name.
    for (const card of cards) {
      expect(card.textContent).not.toMatch(/Already on Home|·/)
    }
  })

  it('adds the block clicked', async () => {
    const { onAdd } = add('Top posts')
    fireEvent.click(screen.getByRole('button', { name: /^Welcome/ }))
    expect(onAdd).toHaveBeenCalledWith('welcome')
    // Where it goes is said on hover and focus, in a tooltip, not as a line always shown.
    const welcome = screen.getByRole('button', { name: /^Welcome/ })
    expect(welcome.getAttribute('title')).toBeNull()
    expect(screen.queryByText(/Drag one onto the page/)).toBeNull()
    act(() => welcome.focus())
    expect(
      await screen.findByText('Drag one onto the page, or click to add it under Top posts.')
    ).toBeTruthy()
  })

  it('shows a block whose page is off greyed, with the page it needs and Turn on', () => {
    const design = defaultDesign()
    render(
      <AddContent
        design={design}
        update={vi.fn()}
        gates={{ ...ALL_ON, help: false }}
        settings={{}}
        after={null}
        onHome
        onAdd={vi.fn()}
      />
    )
    // Not a button to add it, and not left out.
    expect(screen.queryByRole('button', { name: /^Help search/ })).toBeNull()
    const card = screen.getByText('Help search', { exact: false }).closest('div')!
    expect(card.textContent).toContain('Needs Help Center')
    // The name stands alone; Needs and Turn on sit together under the purpose.
    expect(screen.getByText('Help search').textContent).toBe('Help search')
    expect(within(card).getByRole('link', { name: /Turn on/ }).parentElement!.textContent).toMatch(
      /^Needs Help Center/
    )
    const turnOn = within(card).getByRole('link', { name: /Turn on/ })
    expect(turnOn.getAttribute('href')).toBe('/admin/settings/general')
    expect(turnOn.getAttribute('target')).toBe('_blank')
  })

  it('says where a new block goes', () => {
    expect(addHint(null, true)).toBe(
      'Drag one onto the page, or click to add it at the end of Home.'
    )
    expect(addHint('Top posts', false)).toBe('Blocks go on Home. Adding one takes you there.')
  })

  it('leads with blocks suggested for the parts that are on, each added in one click', () => {
    const { onAdd } = add(null, true, true)
    const suggested = screen.getByRole('region', { name: 'Suggested' })
    const cards = within(suggested).getAllByRole('button')
    expect(cards[0]!.textContent).toContain('Help Center is on.')
    fireEvent.click(cards[0]!)
    expect(onAdd).toHaveBeenCalledWith('help_search')
  })

  it('suggests nothing while Home is off', () => {
    add()
    expect(screen.queryByRole('region', { name: 'Suggested' })).toBeNull()
  })
})

describe('the right panel', () => {
  it('is closed and out of reach with nothing picked and no sheet', () => {
    render(
      <RightPanel open={false} hidden={false} showing="nothing" sheet={null}>
        <p>Nothing</p>
      </RightPanel>
    )
    const aside = screen.getByRole('complementary', { hidden: true })
    expect(aside.hasAttribute('inert')).toBe(true)
    expect(aside.hasAttribute('data-open')).toBe(false)
  })
})
