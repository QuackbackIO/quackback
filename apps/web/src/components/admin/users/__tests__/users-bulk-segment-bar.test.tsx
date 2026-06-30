// @vitest-environment happy-dom
/**
 * <UsersBulkSegmentBar> — action bar shown when one or more users are
 * checked in the admin Users list. Purely presentational: the caller owns
 * selection state and mutation wiring.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UsersBulkSegmentBar } from '../users-bulk-segment-bar'
import type { SegmentId } from '@quackback/ids'

const MANUAL_SEGMENTS = [
  { id: 'seg_beta' as SegmentId, name: 'Beta Testers', color: '#3b82f6' },
  { id: 'seg_ent' as SegmentId, name: 'Enterprise', color: '#ef4444' },
]

describe('<UsersBulkSegmentBar>', () => {
  it('shows the selected count', () => {
    render(
      <UsersBulkSegmentBar
        selectedCount={3}
        manualSegments={MANUAL_SEGMENTS}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onClear={vi.fn()}
      />
    )
    expect(screen.getByText('3 selected')).toBeInTheDocument()
  })

  it('calls onAdd with the chosen segment id', () => {
    const onAdd = vi.fn()
    render(
      <UsersBulkSegmentBar
        selectedCount={2}
        manualSegments={MANUAL_SEGMENTS}
        onAdd={onAdd}
        onRemove={vi.fn()}
        onClear={vi.fn()}
      />
    )
    // Radix DropdownMenuTrigger opens on pointerDown (not click).
    fireEvent.pointerDown(screen.getByRole('button', { name: /add to segment/i }))
    fireEvent.click(screen.getByText('Enterprise'))
    expect(onAdd).toHaveBeenCalledWith('seg_ent')
  })

  it('calls onRemove with the chosen segment id', () => {
    const onRemove = vi.fn()
    render(
      <UsersBulkSegmentBar
        selectedCount={2}
        manualSegments={MANUAL_SEGMENTS}
        onAdd={vi.fn()}
        onRemove={onRemove}
        onClear={vi.fn()}
      />
    )
    fireEvent.pointerDown(screen.getByRole('button', { name: /remove from segment/i }))
    fireEvent.click(screen.getByText('Beta Testers'))
    expect(onRemove).toHaveBeenCalledWith('seg_beta')
  })

  it('calls onClear when "Clear" is clicked', () => {
    const onClear = vi.fn()
    render(
      <UsersBulkSegmentBar
        selectedCount={2}
        manualSegments={MANUAL_SEGMENTS}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onClear={onClear}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('disables Add/Remove triggers when there are no manual segments', () => {
    render(
      <UsersBulkSegmentBar
        selectedCount={2}
        manualSegments={[]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onClear={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /add to segment/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /remove from segment/i })).toBeDisabled()
  })

  it('disables the actions while isPending', () => {
    render(
      <UsersBulkSegmentBar
        selectedCount={2}
        manualSegments={MANUAL_SEGMENTS}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onClear={vi.fn()}
        isPending
      />
    )
    expect(screen.getByRole('button', { name: /add to segment/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /remove from segment/i })).toBeDisabled()
  })
})
