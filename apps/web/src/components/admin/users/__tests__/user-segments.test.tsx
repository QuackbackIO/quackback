// @vitest-environment happy-dom
/**
 * <UserSegmentBadges> — per-user manual segment add/remove widget.
 *
 * Covers:
 *   - Existing badge rendering (manual removable, dynamic not)
 *   - Add popover only lists manual segments the user isn't already in
 *   - Assign/remove report success and failure via toast
 *   - Removing shows an "Undo" action that re-assigns the same segment
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UserSegmentBadges } from '../user-segments'
import type { UserSegmentSummary } from '@/lib/shared/types'
import type { PrincipalId, SegmentId } from '@quackback/ids'

const PRINCIPAL_ID = 'principal_1' as PrincipalId

const MANUAL_SEGMENT: UserSegmentSummary = {
  id: 'seg_manual' as SegmentId,
  name: 'Beta Testers',
  color: '#3b82f6',
  type: 'manual',
}

const DYNAMIC_SEGMENT: UserSegmentSummary = {
  id: 'seg_dynamic' as SegmentId,
  name: 'Power Users',
  color: '#22c55e',
  type: 'dynamic',
}

const AVAILABLE_MANUAL_SEGMENT = {
  id: 'seg_available' as SegmentId,
  name: 'Enterprise',
  color: '#ef4444',
  type: 'manual' as const,
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

vi.mock('@/lib/client/hooks/use-segments-queries', () => ({
  useSegments: () => ({
    data: [MANUAL_SEGMENT, DYNAMIC_SEGMENT, AVAILABLE_MANUAL_SEGMENT],
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  assignMutateAsync.mockResolvedValue({ assigned: 1 })
  removeMutateAsync.mockResolvedValue({ removed: 1 })
})

describe('<UserSegmentBadges>', () => {
  it('renders a badge per current segment', () => {
    render(
      <UserSegmentBadges
        principalId={PRINCIPAL_ID}
        segments={[MANUAL_SEGMENT, DYNAMIC_SEGMENT]}
        canManage
      />
    )
    expect(screen.getByText('Beta Testers')).toBeInTheDocument()
    expect(screen.getByText('Power Users')).toBeInTheDocument()
  })

  it('only shows a remove control for manual segments', () => {
    render(
      <UserSegmentBadges
        principalId={PRINCIPAL_ID}
        segments={[MANUAL_SEGMENT, DYNAMIC_SEGMENT]}
        canManage
      />
    )
    expect(screen.getByLabelText('Remove from Beta Testers')).toBeInTheDocument()
    expect(screen.queryByLabelText('Remove from Power Users')).toBeNull()
  })

  it('Add popover excludes manual segments the user is already in', () => {
    render(
      <UserSegmentBadges
        principalId={PRINCIPAL_ID}
        segments={[MANUAL_SEGMENT, DYNAMIC_SEGMENT]}
        canManage
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /add/i }))
    expect(screen.getByText('Enterprise')).toBeInTheDocument()
    // Already a member of "Beta Testers" — shouldn't reappear inside the popover list
    expect(screen.queryAllByText('Beta Testers')).toHaveLength(1)
  })

  it('assigning a segment shows a success toast', async () => {
    render(<UserSegmentBadges principalId={PRINCIPAL_ID} segments={[]} canManage />)
    fireEvent.click(screen.getByRole('button', { name: /add/i }))
    fireEvent.click(screen.getByText('Enterprise'))

    await waitFor(() =>
      expect(assignMutateAsync).toHaveBeenCalledWith({
        segmentId: AVAILABLE_MANUAL_SEGMENT.id,
        principalIds: [PRINCIPAL_ID],
      })
    )
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Added to Enterprise'))
  })

  it('shows an error toast when assigning fails, without crashing', async () => {
    assignMutateAsync.mockRejectedValueOnce(new Error('network blip'))
    render(<UserSegmentBadges principalId={PRINCIPAL_ID} segments={[]} canManage />)
    fireEvent.click(screen.getByRole('button', { name: /add/i }))
    fireEvent.click(screen.getByText('Enterprise'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to add to Enterprise'))
  })

  it('removing a segment shows a success toast with an Undo action', async () => {
    render(<UserSegmentBadges principalId={PRINCIPAL_ID} segments={[MANUAL_SEGMENT]} canManage />)
    fireEvent.click(screen.getByLabelText('Remove from Beta Testers'))

    await waitFor(() =>
      expect(removeMutateAsync).toHaveBeenCalledWith({
        segmentId: MANUAL_SEGMENT.id,
        principalIds: [PRINCIPAL_ID],
      })
    )
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        'Removed from Beta Testers',
        expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) })
      )
    )
  })

  it('clicking Undo on the remove toast re-assigns the same segment', async () => {
    render(<UserSegmentBadges principalId={PRINCIPAL_ID} segments={[MANUAL_SEGMENT]} canManage />)
    fireEvent.click(screen.getByLabelText('Remove from Beta Testers'))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())

    const [, options] = toastSuccess.mock.calls[0] as [string, { action: { onClick: () => void } }]
    options.action.onClick()

    expect(assignMutate).toHaveBeenCalledWith(
      { segmentId: MANUAL_SEGMENT.id, principalIds: [PRINCIPAL_ID] },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    )
  })

  it('calls onSegmentsChange again once the Undo re-assign succeeds', async () => {
    const onSegmentsChange = vi.fn()
    render(
      <UserSegmentBadges
        principalId={PRINCIPAL_ID}
        segments={[MANUAL_SEGMENT]}
        canManage
        onSegmentsChange={onSegmentsChange}
      />
    )
    fireEvent.click(screen.getByLabelText('Remove from Beta Testers'))
    await waitFor(() => expect(onSegmentsChange).toHaveBeenCalledTimes(1))

    const [, toastOptions] = toastSuccess.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ]
    toastOptions.action.onClick()
    const [, mutateOptions] = assignMutate.mock.calls[0] as [unknown, { onSuccess: () => void }]
    mutateOptions.onSuccess()

    expect(onSegmentsChange).toHaveBeenCalledTimes(2)
  })

  it('shows an error toast if the Undo re-assign itself fails', async () => {
    render(<UserSegmentBadges principalId={PRINCIPAL_ID} segments={[MANUAL_SEGMENT]} canManage />)
    fireEvent.click(screen.getByLabelText('Remove from Beta Testers'))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())

    const [, toastOptions] = toastSuccess.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ]
    toastOptions.action.onClick()
    const [, mutateOptions] = assignMutate.mock.calls[0] as [unknown, { onError: () => void }]
    mutateOptions.onError()

    expect(toastError).toHaveBeenCalledWith('Failed to undo — Beta Testers was not restored')
  })

  it('shows an error toast when removal fails', async () => {
    removeMutateAsync.mockRejectedValueOnce(new Error('network blip'))
    render(<UserSegmentBadges principalId={PRINCIPAL_ID} segments={[MANUAL_SEGMENT]} canManage />)
    fireEvent.click(screen.getByLabelText('Remove from Beta Testers'))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Failed to remove from Beta Testers')
    )
  })
})
