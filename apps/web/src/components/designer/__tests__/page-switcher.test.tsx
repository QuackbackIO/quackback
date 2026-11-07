// @vitest-environment happy-dom
/**
 * The page switcher: every page by module, found by search, gone to with
 * Enter or a click; "Choose one" lists real posts, entries or articles; a
 * part turned off is a sample, or the way to turn one on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { switcherColumns, type DesignerPlaces } from '@/lib/shared/design/page-switcher'
import { defaultDesign } from '@/lib/shared/design/schema'
import { SwitcherMenu, switcherFilter } from '../page-switcher'

afterEach(cleanup)

const gates: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: false,
  support: false,
  status: false,
}

const places: DesignerPlaces = {
  boards: [{ id: 'b1', name: 'Bugs', slug: 'bugs' }],
  roadmaps: [],
  categories: [],
  posts: [
    { id: 'p1', title: 'Dark mode', path: '/b/bugs/posts/p1' },
    { id: 'p2', title: 'Offline', path: '/b/bugs/posts/p2' },
  ],
  entries: [],
  articles: [],
}

function show() {
  const design = defaultDesign()
  const handlers = { onPage: vi.fn(), onSample: vi.fn(), onTurnOn: vi.fn() }
  render(
    <SwitcherMenu
      columns={switcherColumns({
        design,
        gates,
        places,
        here: { page: 'changelog', item: null },
        sample: null,
      })}
      places={places}
      loading={false}
      {...handlers}
    />
  )
  const search = screen.getByPlaceholderText('Find a page, board, entry or article')
  return { ...handlers, search }
}

describe('SwitcherMenu', () => {
  it('lists each module with how it shows in the menu, the page shown filled', () => {
    show()
    expect(screen.getByText('In the menu as "Feedback"')).toBeTruthy()
    const here = screen.getByRole('option', { name: /Changelog/ })
    expect(here.getAttribute('aria-current')).toBe('page')
    expect(within(here).getByText('You are here')).toBeTruthy()
  })

  it('finds a page by search, and Enter goes there', () => {
    const { search, onPage } = show()
    fireEvent.change(search, { target: { value: 'bugs' } })
    expect(screen.queryByRole('option', { name: /All boards/ })).toBeNull()
    expect(screen.getByRole('option', { name: /Bugs/ })).toBeTruthy()
    // Home is off, so the feed is the root.
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onPage).toHaveBeenCalledWith('feedback', '/?board=bugs')
  })

  it('moves with the arrow keys', () => {
    const { search, onPage } = show()
    fireEvent.change(search, { target: { value: 'board' } })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onPage).toHaveBeenCalledWith('feedback', '/?board=bugs')
  })

  it('chooses one post from the list, and goes back to every page', () => {
    const { onPage } = show()
    fireEvent.click(screen.getByRole('option', { name: /A post/ }))
    expect(screen.getByText('Choose a post')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'All pages' }))
    fireEvent.click(screen.getByRole('option', { name: /A post/ }))
    fireEvent.click(screen.getByRole('option', { name: 'Offline' }))
    expect(onPage).toHaveBeenCalledWith('post', '/b/bugs/posts/p2')
  })

  it('shows a part turned off as a sample, and leads to turning one on', () => {
    const { onSample, onTurnOn } = show()
    fireEvent.click(screen.getByRole('option', { name: /Support/ }))
    expect(onSample).toHaveBeenCalledWith('support')
    fireEvent.click(screen.getByRole('option', { name: /Turn one on/ }))
    expect(onTurnOn).toHaveBeenCalled()
  })

  it('leaves out the pages the builder does not draw yet', () => {
    show()
    expect(screen.queryByRole('option', { name: /Sign in/ })).toBeNull()
    expect(screen.queryByRole('option', { name: /Your account/ })).toBeNull()
  })
})

describe('switcherFilter', () => {
  it('leads with a row whose name starts with the search, over one that only mentions it', () => {
    const page = switcherFilter('roadmap:page', 'roadmap', ['Roadmap'])
    const board = switcherFilter('E2E Public board:b1', 'roadmap', ['E2E Public', 'Roadmap'])
    expect(board).toBeGreaterThan(0)
    expect(page).toBeGreaterThan(board)
  })

  it('leaves out what does not match', () => {
    expect(switcherFilter('changelog:page', 'roadmap', ['Changelog'])).toBe(0)
  })
})
