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

  it('checks active statuses by default and all of them while searching', () => {
    renderPanel()
    expect(screen.getByRole('checkbox', { name: /Open/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Complete/ })).not.toBeChecked()
    cleanup()
    renderPanel({ filters: { sort: 'trending', search: 'dark' } })
    expect(screen.getByRole('checkbox', { name: /Complete/ })).toBeChecked()
  })

  it('adds a status to the default scope when one is checked', () => {
    const { setFilters } = renderPanel()
    fireEvent.click(screen.getByRole('checkbox', { name: /Complete/ }))
    expect(setFilters).toHaveBeenCalledWith({ status: ['open', 'planned', 'complete'] })
  })

  it('falls back to the default when the last status is unchecked', () => {
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

  it('renders without counts while they load', () => {
    renderPanel({ counts: undefined })
    expect(
      within(section('Boards')).getByRole('button', { name: 'Bug Reports' })
    ).toBeInTheDocument()
  })
})
