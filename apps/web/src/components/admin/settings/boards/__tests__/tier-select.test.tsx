// @vitest-environment happy-dom
/**
 * <TierSelect> — 4-segment radio for picking an AccessTier.
 *
 * Covers the visible behaviors:
 *   - Renders the four tier options with the expected labels
 *   - Reflects the `value` prop as the currently-checked radio
 *   - Fires `onChange` with the new tier when an option is clicked
 *   - Dims (disables) tier options whose rank is below `minTier`
 *   - Disables every option when the global `disabled` prop is set
 *
 * Pure presentation, no server calls — no QueryClient, no mocks needed.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TierSelect } from '../tier-select'

describe('TierSelect', () => {
  it('renders four tier options', () => {
    render(<TierSelect value="anonymous" onChange={() => {}} ariaLabel="Test tier" />)
    expect(screen.getByRole('radio', { name: /anyone/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /signed-in/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /segments/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /team only/i })).toBeInTheDocument()
  })

  it('selects the value prop', () => {
    render(<TierSelect value="authenticated" onChange={() => {}} ariaLabel="Test" />)
    expect(screen.getByRole('radio', { name: /signed-in/i })).toBeChecked()
  })

  it('fires onChange when a new tier is clicked', () => {
    const onChange = vi.fn()
    render(<TierSelect value="anonymous" onChange={onChange} ariaLabel="Test" />)
    fireEvent.click(screen.getByRole('radio', { name: /segments/i }))
    expect(onChange).toHaveBeenCalledWith('segments')
  })

  it('disables tier options below minTier', () => {
    render(
      <TierSelect
        value="authenticated"
        onChange={() => {}}
        minTier="authenticated"
        ariaLabel="Test"
      />
    )
    expect(screen.getByRole('radio', { name: /anyone/i })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /signed-in/i })).not.toBeDisabled()
  })

  it('respects the disabled prop globally', () => {
    render(<TierSelect value="anonymous" onChange={() => {}} disabled ariaLabel="Test" />)
    expect(screen.getByRole('radio', { name: /anyone/i })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /segments/i })).toBeDisabled()
  })
})
