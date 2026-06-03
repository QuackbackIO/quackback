// @vitest-environment happy-dom
/**
 * <SegmentMultiSelect> — pure presentational, no data fetching.
 *
 * The component renders a checkbox per segment, toggles `value` on
 * click, and respects the `disabled` prop. Member counts are optional
 * and pluralized via the same singular/plural rule the rest of the
 * admin UI uses ("1 member" / "2 members").
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SegmentMultiSelect } from '../segment-multi-select'

const SEGMENTS = [
  { id: 'seg_1', name: 'Active Users', memberCount: 27 },
  { id: 'seg_2', name: 'New Users', memberCount: 0 },
  { id: 'seg_3', name: 'Pro Users', memberCount: 1 },
  // intentionally no memberCount on this one
  { id: 'seg_4', name: 'Beta Testers' },
]

describe('<SegmentMultiSelect>', () => {
  it('renders one checkbox row per segment with member counts', () => {
    render(<SegmentMultiSelect segments={SEGMENTS} value={[]} onChange={vi.fn()} />)

    expect(screen.getByText('Active Users')).toBeInTheDocument()
    expect(screen.getByText('New Users')).toBeInTheDocument()
    expect(screen.getByText('Pro Users')).toBeInTheDocument()
    expect(screen.getByText('Beta Testers')).toBeInTheDocument()

    // Plural / singular / zero / absent
    expect(screen.getByText('27 members')).toBeInTheDocument()
    expect(screen.getByText('0 members')).toBeInTheDocument()
    expect(screen.getByText('1 member')).toBeInTheDocument()
    // No member-count span for the segment without memberCount
    expect(screen.queryByText(/Beta Testers.*members?/)).toBeNull()
  })

  it('renders 4 checkboxes (one per segment)', () => {
    render(<SegmentMultiSelect segments={SEGMENTS} value={[]} onChange={vi.fn()} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
  })

  it('reflects the value prop as checked state', () => {
    render(<SegmentMultiSelect segments={SEGMENTS} value={['seg_1', 'seg_3']} onChange={vi.fn()} />)
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes[0].checked).toBe(true) // Active Users
    expect(boxes[1].checked).toBe(false) // New Users
    expect(boxes[2].checked).toBe(true) // Pro Users
    expect(boxes[3].checked).toBe(false) // Beta Testers
  })

  it('calls onChange with the new array when a checkbox is toggled on', () => {
    const onChange = vi.fn()
    render(<SegmentMultiSelect segments={SEGMENTS} value={[]} onChange={onChange} />)
    fireEvent.click(screen.getAllByRole('checkbox')[1]) // New Users
    expect(onChange).toHaveBeenCalledWith(['seg_2'])
  })

  it('calls onChange with the segment removed when a checked box is clicked', () => {
    const onChange = vi.fn()
    render(
      <SegmentMultiSelect segments={SEGMENTS} value={['seg_1', 'seg_2']} onChange={onChange} />
    )
    fireEvent.click(screen.getAllByRole('checkbox')[0]) // Active Users
    expect(onChange).toHaveBeenCalledWith(['seg_2'])
  })

  it('preserves order from the input value when adding to a non-empty selection', () => {
    const onChange = vi.fn()
    render(<SegmentMultiSelect segments={SEGMENTS} value={['seg_1']} onChange={onChange} />)
    fireEvent.click(screen.getAllByRole('checkbox')[2]) // Pro Users
    expect(onChange).toHaveBeenCalledWith(['seg_1', 'seg_3'])
  })

  it('does not call onChange or check the box when disabled', () => {
    const onChange = vi.fn()
    render(<SegmentMultiSelect segments={SEGMENTS} value={[]} onChange={onChange} disabled />)
    const box = screen.getAllByRole('checkbox')[0] as HTMLInputElement
    fireEvent.click(box)
    expect(onChange).not.toHaveBeenCalled()
    expect(box.disabled).toBe(true)
  })

  it('uses the default ARIA label "Segment allowlist"', () => {
    render(<SegmentMultiSelect segments={SEGMENTS} value={[]} onChange={vi.fn()} />)
    expect(screen.getByRole('list', { name: 'Segment allowlist' })).toBeInTheDocument()
  })

  it('respects a custom ariaLabel for surfaces where "allowlist" is the wrong term', () => {
    render(
      <SegmentMultiSelect
        segments={SEGMENTS}
        value={[]}
        onChange={vi.fn()}
        ariaLabel="Allowed segments for this board"
      />
    )
    expect(
      screen.getByRole('list', { name: 'Allowed segments for this board' })
    ).toBeInTheDocument()
  })

  it('renders an empty list when given no segments', () => {
    render(<SegmentMultiSelect segments={[]} value={[]} onChange={vi.fn()} />)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })
})
