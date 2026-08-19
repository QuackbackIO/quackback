// @vitest-environment happy-dom
/**
 * <SegmentPickerList> — shared "pick one segment" content for popovers.
 *
 * Covers:
 *   - Renders one row per segment with a color dot + name
 *   - Search input only appears once the list exceeds the threshold
 *   - Typing filters the visible rows
 *   - Selecting a row calls onSelect with that segment's id
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SegmentPickerList } from '../segment-picker-list'
import type { SegmentId } from '@quackback/ids'

function makeSegments(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `seg_${i}` as SegmentId,
    name: `Segment ${i}`,
    color: '#3b82f6',
  }))
}

describe('<SegmentPickerList>', () => {
  it('renders one row per segment', () => {
    render(<SegmentPickerList segments={makeSegments(3)} onSelect={vi.fn()} />)
    expect(screen.getByText('Segment 0')).toBeInTheDocument()
    expect(screen.getByText('Segment 1')).toBeInTheDocument()
    expect(screen.getByText('Segment 2')).toBeInTheDocument()
  })

  it('hides the search input at or below the threshold', () => {
    render(<SegmentPickerList segments={makeSegments(6)} onSelect={vi.fn()} />)
    expect(screen.queryByPlaceholderText('Search segments...')).toBeNull()
  })

  it('shows the search input once the list exceeds the threshold', () => {
    render(<SegmentPickerList segments={makeSegments(7)} onSelect={vi.fn()} />)
    expect(screen.getByPlaceholderText('Search segments...')).toBeInTheDocument()
  })

  it('respects a custom searchThreshold', () => {
    render(<SegmentPickerList segments={makeSegments(3)} onSelect={vi.fn()} searchThreshold={2} />)
    expect(screen.getByPlaceholderText('Search segments...')).toBeInTheDocument()
  })

  it('filters rows as the admin types', () => {
    render(<SegmentPickerList segments={makeSegments(7)} onSelect={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Search segments...'), {
      target: { value: 'Segment 3' },
    })
    expect(screen.getByText('Segment 3')).toBeInTheDocument()
    expect(screen.queryByText('Segment 0')).toBeNull()
  })

  it('calls onSelect with the chosen segment id', () => {
    const onSelect = vi.fn()
    render(<SegmentPickerList segments={makeSegments(3)} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Segment 1'))
    expect(onSelect).toHaveBeenCalledWith('seg_1')
  })

  it('shows the empty message when there are no segments', () => {
    render(<SegmentPickerList segments={[]} onSelect={vi.fn()} emptyMessage="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })
})
