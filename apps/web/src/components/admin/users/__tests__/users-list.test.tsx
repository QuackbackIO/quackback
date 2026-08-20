// @vitest-environment happy-dom
/**
 * <UsersList> — people table chrome.
 *
 * Covers:
 *   - Loaded rows render without a multi-select bar
 *   - Metric and identity column headers
 *   - Optional Country column via the Columns menu
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { UsersList } from '../users-list'
import { installInMemoryLocalStorage } from '@/test/local-storage'
import type { PortalUserListItemView, UsersFilters } from '@/lib/shared/types'
import type { PrincipalId, SegmentId } from '@quackback/ids'

beforeAll(() => {
  installInMemoryLocalStorage()
})

function makeUser(i: number): PortalUserListItemView {
  return {
    principalId: `principal_${i}` as PrincipalId,
    userId: `user_${i}`,
    name: `User ${i}`,
    email: `user${i}@example.com`,
    image: null,
    emailVerified: true,
    joinedAt: '2026-01-01T00:00:00.000Z',
    postCount: 0,
    commentCount: 0,
    voteCount: 0,
    segments: [],
    metadata: null,
    isLead: false,
    contactEmail: null,
    lastSeenAt: null,
    country: i === 1 ? 'US' : null,
  }
}

const USERS = [makeUser(1), makeUser(2), makeUser(3)]

const MANUAL_SEGMENT = {
  id: 'seg_manual' as SegmentId,
  name: 'Beta Testers',
  slug: 'beta-testers',
  color: '#3b82f6',
  type: 'manual' as const,
  description: null,
  memberCount: 0,
  rules: null,
  evaluationSchedule: null,
  weightConfig: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const noop = () => {}
const FILTERS: UsersFilters = { sort: 'newest' }

function renderList(
  users: PortalUserListItemView[] = USERS,
  overrides: Partial<React.ComponentProps<typeof UsersList>> = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <IntlProvider locale="en" messages={{}}>
      <QueryClientProvider client={queryClient}>
        <UsersList
          users={users}
          hasMore={false}
          isLoading={false}
          isLoadingMore={false}
          selectedUserId={null}
          onSelectUser={noop}
          onLoadMore={noop}
          filters={FILTERS}
          onFiltersChange={noop}
          hasActiveFilters={false}
          onClearFilters={noop}
          total={users.length}
          segments={[MANUAL_SEGMENT]}
          selectedSegmentIds={[]}
          onSelectSegment={noop}
          onClearSegments={noop}
          canManage
          {...overrides}
        />
      </QueryClientProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('<UsersList>', () => {
  it('renders loaded users without a multi-select bar', () => {
    renderList()
    expect(screen.getByText('User 1')).toBeInTheDocument()
    expect(screen.queryByText(/selected/)).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /Select User/ })).toBeNull()
  })
})

describe('<UsersList> metric column headers', () => {
  it('labels the post, comment and vote counts as scannable table columns', () => {
    renderList()
    expect(screen.getByText('Posts')).toBeInTheDocument()
    expect(screen.getByText('Comments')).toBeInTheDocument()
    expect(screen.getByText('Votes')).toBeInTheDocument()
  })

  it('labels every field with a column header, not just the numeric columns', () => {
    renderList()
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.getByText('Joined')).toBeInTheDocument()
  })

  it('adds a Country column header once the field is turned on', async () => {
    renderList()
    expect(screen.queryByText('Country')).toBeNull()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Columns' }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Country' }))
    expect(await screen.findAllByText('Country')).not.toHaveLength(0)
  })
})

describe('<UsersList> column picker', () => {
  it('does not show the Country field until the column is turned on', () => {
    renderList()
    expect(screen.queryByText('United States')).toBeNull()
  })

  it('shows the Country field for every row once turned on from the Columns menu', async () => {
    renderList()
    // Radix DropdownMenuTrigger opens on pointerDown (not click).
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Columns' }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Country' }))
    expect(await screen.findByText('United States')).toBeInTheDocument()
  })

  it('remembers the Country column choice across remounts', async () => {
    const first = renderList()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Columns' }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Country' }))
    expect(await screen.findByText('United States')).toBeInTheDocument()

    first.unmount()
    renderList()
    expect(screen.getByText('United States')).toBeInTheDocument()
  })

  it('remembers turning the column back off across remounts', async () => {
    const first = renderList()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Columns' }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Country' }))
    expect(await screen.findByText('United States')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Columns' }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Country' }))
    expect(screen.queryByText('United States')).toBeNull()

    first.unmount()
    renderList()
    expect(screen.queryByText('United States')).toBeNull()
  })

  it('turning the column back off hides it again', async () => {
    renderList()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Columns' }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Country' }))
    expect(await screen.findByText('United States')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Columns' }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Country' }))
    expect(screen.queryByText('United States')).toBeNull()
  })
})
