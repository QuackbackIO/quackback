// @vitest-environment happy-dom
/**
 * <UsersList> — bulk segment selection.
 *
 * Covers:
 *   - Checking rows surfaces a bulk action bar with the right count
 *   - Bulk add/remove call the segment mutations with every selected id
 *   - A successful bulk action clears the selection and shows a toast
 *   - The header "select all" checkbox selects/deselects every loaded user
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UsersList } from '../users-list'
import type { PortalUserListItemView, UsersFilters } from '@/lib/shared/types'
import type { PrincipalId, SegmentId } from '@quackback/ids'

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

const assignMutateAsync = vi.fn()
const assignMutate = vi.fn()
const removeMutateAsync = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

vi.mock('@/lib/client/mutations', () => ({
  useAssignUsersToSegment: () => ({
    mutateAsync: assignMutateAsync,
    mutate: assignMutate,
    isPending: false,
  }),
  useRemoveUsersFromSegment: () => ({
    mutateAsync: removeMutateAsync,
    isPending: false,
  }),
}))

const noop = () => {}
const FILTERS: UsersFilters = { sort: 'newest' }

function renderList(users: PortalUserListItemView[] = USERS) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
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
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  assignMutateAsync.mockResolvedValue({ assigned: 2 })
  removeMutateAsync.mockResolvedValue({ removed: 2 })
})

describe('<UsersList> bulk segment selection', () => {
  it('shows no bulk bar until a row is checked', () => {
    renderList()
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it('shows "1 selected" after checking one row', () => {
    renderList()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select User 1' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('bulk-adds every checked user to the chosen segment, then clears selection', async () => {
    renderList()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select User 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select User 2' }))

    fireEvent.pointerDown(screen.getByRole('button', { name: /add to segment/i }))
    fireEvent.click(screen.getByText('Beta Testers'))

    await waitFor(() =>
      expect(assignMutateAsync).toHaveBeenCalledWith({
        segmentId: MANUAL_SEGMENT.id,
        principalIds: ['principal_1', 'principal_2'],
      })
    )
    await waitFor(() => expect(screen.queryByText(/selected/)).toBeNull())
    expect(toastSuccess).toHaveBeenCalledWith('Added 2 people to Beta Testers')
  })

  it('bulk-removes every checked user, with an Undo action on the toast', async () => {
    renderList()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select User 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select User 2' }))

    fireEvent.pointerDown(screen.getByRole('button', { name: /remove from segment/i }))
    fireEvent.click(screen.getByText('Beta Testers'))

    await waitFor(() =>
      expect(removeMutateAsync).toHaveBeenCalledWith({
        segmentId: MANUAL_SEGMENT.id,
        principalIds: ['principal_1', 'principal_2'],
      })
    )
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'Removed 2 people from Beta Testers',
        expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) })
      )
    )
  })

  it('"select all" checkbox selects every loaded user, and toggling again clears it', () => {
    renderList()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all loaded users' }))
    expect(screen.getByText('3 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all loaded users' }))
    expect(screen.queryByText(/selected/)).toBeNull()
  })
})
