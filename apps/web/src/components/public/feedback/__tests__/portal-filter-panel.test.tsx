// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { PostStatusEntity, PostTag } from '@/lib/shared/db-types'
import type { PublicFeedbackFilters } from '@/lib/shared/types'
import { PortalFilterPanel } from '../portal-filter-panel'

afterEach(cleanup)

const statuses = [
  { id: 's1', slug: 'open', name: 'Open', color: '#3b82f6', category: 'active' },
  { id: 's2', slug: 'planned', name: 'Planned', color: '#a855f7', category: 'active' },
  { id: 's3', slug: 'complete', name: 'Complete', color: '#22c55e', category: 'complete' },
  { id: 's4', slug: 'closed', name: 'Closed', color: '#737373', category: 'closed' },
] as unknown as PostStatusEntity[]

const tags = [
  { id: 'tag_api', name: 'API', color: '#84cc16' },
  { id: 'tag_ui', name: 'UI', color: '#38bdf8' },
] as unknown as PostTag[]

const boards = [
  { id: 'b1', slug: 'bugs', name: 'Bug Reports' },
  { id: 'b2', slug: 'ideas', name: 'Feature Requests' },
]

const counts = {
  statuses: { open: 4, planned: 2, complete: 9, closed: 1 },
  boards: { bugs: 5, ideas: 6 },
  tags: { tag_api: 3, tag_ui: 2 },
  total: 6,
  views: { mine: 2, voted: 3, following: 1 },
}

function renderPanel(props: Partial<React.ComponentProps<typeof PortalFilterPanel>> = {}) {
  const setFilters = vi.fn()
  render(
    <IntlProvider locale="en">
      <PortalFilterPanel
        filters={{ sort: 'trending' } as PublicFeedbackFilters}
        setFilters={setFilters}
        boards={boards}
        statuses={statuses}
        tags={tags}
        counts={counts}
        showViews
        {...props}
      />
    </IntlProvider>
  )
  return { setFilters }
}

const section = (name: string) => screen.getByRole('group', { name })

describe('PortalFilterPanel', () => {
  it('shows views with counts for a signed-in viewer and switches between them', () => {
    const { setFilters } = renderPanel()
    const show = section('Show')
    expect(within(show).getByRole('button', { name: /My ideas\s*2/ })).toBeInTheDocument()
    fireEvent.click(within(show).getByRole('button', { name: /Following/ }))
    expect(setFilters).toHaveBeenCalledWith({ view: 'following' })
    fireEvent.click(within(show).getByRole('button', { name: /All ideas/ }))
    expect(setFilters).toHaveBeenCalledWith({ view: undefined })
  })

  it('has no Show section for anonymous visitors', () => {
    renderPanel({ showViews: false })
    expect(screen.queryByRole('group', { name: 'Show' })).not.toBeInTheDocument()
  })

  it('picks one board at a time, with counts', () => {
    const { setFilters } = renderPanel()
    const list = section('Boards')
    fireEvent.click(within(list).getByRole('button', { name: /Bug Reports\s*5/ }))
    expect(setFilters).toHaveBeenCalledWith({ board: 'bugs' })
  })

  it('hides Boards when there is only one board', () => {
    renderPanel({ boards: [boards[0]!] })
    expect(screen.queryByRole('group', { name: 'Boards' })).not.toBeInTheDocument()
  })

  it('ticks what the feed shows: the active statuses by default', () => {
    renderPanel()
    expect(screen.getByRole('checkbox', { name: /Open/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Planned/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Complete/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Closed/ })).not.toBeChecked()
  })

  it('ticks every status while searching, since search looks everywhere', () => {
    renderPanel({ filters: { sort: 'trending', search: 'dark' } })
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeChecked()
  })

  it('adds a status to the default scope when ticked', () => {
    const { setFilters } = renderPanel()
    fireEvent.click(screen.getByRole('checkbox', { name: /Complete/ }))
    expect(setFilters).toHaveBeenCalledWith({ status: ['open', 'planned', 'complete'] })
  })

  it('drops a status from the default scope when unticked', () => {
    const { setFilters } = renderPanel()
    fireEvent.click(screen.getByRole('checkbox', { name: /Open/ }))
    expect(setFilters).toHaveBeenCalledWith({ status: ['planned'] })
  })

  it('keeps the URL clean when the pick matches the default again', () => {
    const { setFilters } = renderPanel({
      filters: { sort: 'trending', status: ['open', 'planned', 'complete'] },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Complete/ }))
    expect(setFilters).toHaveBeenCalledWith({ status: undefined })
  })

  it('"Only" shows just that status', () => {
    const { setFilters } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Show only Complete' }))
    expect(setFilters).toHaveBeenCalledWith({ status: ['complete'] })
  })

  it('adds a status to the ones already picked, in workspace order', () => {
    const { setFilters } = renderPanel({ filters: { sort: 'trending', status: ['complete'] } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Open/ }))
    expect(setFilters).toHaveBeenCalledWith({ status: ['open', 'complete'] })
  })

  it('understands statuses named by id in the URL', () => {
    renderPanel({ filters: { sort: 'trending', status: ['s3'] } })
    expect(screen.getByRole('checkbox', { name: /Complete/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Open/ })).not.toBeChecked()
  })

  it('goes back to the default when the last status is unticked', () => {
    const { setFilters } = renderPanel({ filters: { sort: 'trending', status: ['closed'] } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Closed/ }))
    expect(setFilters).toHaveBeenCalledWith({ status: undefined })
  })

  it('groups statuses as Active, Complete and Closed with counts', () => {
    renderPanel()
    const status = section('Status')
    expect(within(status).getByText('Active')).toBeInTheDocument()
    expect(within(status).getByText('9')).toBeInTheDocument()
  })

  it('toggles tags and hides the section with fewer than two tags', () => {
    const { setFilters } = renderPanel()
    fireEvent.click(within(section('Tags')).getByRole('button', { name: 'API' }))
    expect(setFilters).toHaveBeenCalledWith({ tagIds: ['tag_api'] })
    cleanup()
    renderPanel({ tags: [tags[0]!] })
    expect(screen.queryByRole('group', { name: 'Tags' })).not.toBeInTheDocument()
  })

  it('shows no number for a row with no posts', () => {
    renderPanel({ counts: { ...counts, statuses: { ...counts.statuses, closed: 0 } } })
    expect(screen.getByRole('checkbox', { name: 'Closed' })).toBeInTheDocument()
  })

  it('leaves out tags on no visible post, unless picked', () => {
    renderPanel({ counts: { ...counts, tags: { tag_api: 3 } } })
    expect(screen.queryByRole('group', { name: 'Tags' })).not.toBeInTheDocument()
    cleanup()
    renderPanel({
      counts: { ...counts, tags: { tag_api: 3 } },
      filters: { sort: 'trending', tagIds: ['tag_ui'] },
    })
    expect(within(section('Tags')).getByRole('button', { name: 'UI' })).toBeInTheDocument()
  })

  it('folds a long tag list behind "N more"', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `tag_${i}`,
      name: `Tag ${i}`,
      color: '#84cc16',
    })) as unknown as PostTag[]
    renderPanel({ tags: many, counts: undefined })
    const list = section('Tags')
    expect(within(list).queryByRole('button', { name: 'Tag 14' })).not.toBeInTheDocument()
    fireEvent.click(within(list).getByRole('button', { name: '3 more' }))
    expect(within(list).getByRole('button', { name: 'Tag 14' })).toBeInTheDocument()
  })

  it('puts Status before Boards in the phone sheet', () => {
    renderPanel({ layout: 'sheet', showViews: false })
    const names = screen
      .getAllByRole('group')
      .map((group) => group.getAttribute('aria-labelledby'))
      .map((id) => document.getElementById(id!)?.textContent)
    expect(names.indexOf('Status')).toBeLessThan(names.indexOf('Boards'))
  })

  it('renders without counts while they load', () => {
    renderPanel({ counts: undefined })
    expect(
      within(section('Boards')).getByRole('button', { name: 'Bug Reports' })
    ).toBeInTheDocument()
  })
})
