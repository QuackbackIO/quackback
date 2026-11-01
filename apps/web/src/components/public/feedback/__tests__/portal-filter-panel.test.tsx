// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { PortalWordsIntl } from '@/lib/client/hooks/use-intl-setup'
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
      <PortalWordsIntl>
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
      </PortalWordsIntl>
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

  it('folds boards past six behind "N more", keeping the picked one listed', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `b${i}`,
      slug: `board-${i}`,
      name: `Board ${i}`,
    }))
    renderPanel({ boards: many, filters: { sort: 'trending', board: 'board-8' } })
    const list = section('Boards')
    expect(within(list).queryByRole('button', { name: 'Board 7' })).not.toBeInTheDocument()
    expect(within(list).getByRole('button', { name: 'Board 8' })).toBeInTheDocument()
    fireEvent.click(within(list).getByRole('button', { name: '2 more' }))
    expect(within(list).getByRole('button', { name: 'Board 7' })).toBeInTheDocument()
  })

  it('hides Boards when there is only one board', () => {
    renderPanel({ boards: [boards[0]!] })
    expect(screen.queryByRole('group', { name: 'Boards' })).not.toBeInTheDocument()
  })

  const statusPill = (name: string) =>
    within(section('Status')).getByRole('button', { name: new RegExp(`^${name}`) })

  it('lights no status by default, while the feed shows its default scope', () => {
    renderPanel()
    for (const pill of within(section('Status')).getAllByRole('button')) {
      expect(pill).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('narrows to a status on the first pick', () => {
    const { setFilters } = renderPanel()
    fireEvent.click(statusPill('Complete'))
    expect(setFilters).toHaveBeenCalledWith({ status: ['complete'] })
  })

  it('adds a status to the ones already picked, in workspace order', () => {
    const { setFilters } = renderPanel({ filters: { sort: 'trending', status: ['complete'] } })
    expect(statusPill('Complete')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(statusPill('Open'))
    expect(setFilters).toHaveBeenCalledWith({ status: ['open', 'complete'] })
  })

  it('understands statuses named by id in the URL', () => {
    renderPanel({ filters: { sort: 'trending', status: ['s3'] } })
    expect(statusPill('Complete')).toHaveAttribute('aria-pressed', 'true')
    expect(statusPill('Open')).toHaveAttribute('aria-pressed', 'false')
  })

  it('goes back to the default when the last status is unpicked', () => {
    const { setFilters } = renderPanel({ filters: { sort: 'trending', status: ['closed'] } })
    fireEvent.click(statusPill('Closed'))
    expect(setFilters).toHaveBeenCalledWith({ status: undefined })
  })

  it('lists statuses active first, then complete, then closed, with counts', () => {
    renderPanel({ statuses: [...statuses].reverse() })
    const names = within(section('Status'))
      .getAllByRole('button')
      .map((pill) => pill.getAttribute('title'))
    expect(names).toEqual(['Planned', 'Open', 'Complete', 'Closed'])
    expect(statusPill('Complete')).toHaveTextContent('9')
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
    expect(within(section('Status')).getByRole('button', { name: 'Closed' })).toBeInTheDocument()
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
    fireEvent.click(within(list).getByRole('button', { name: '7 more' }))
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
