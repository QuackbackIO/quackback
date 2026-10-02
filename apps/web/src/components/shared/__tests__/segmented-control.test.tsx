// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SegmentedControl } from '../segmented-control'

const OPTIONS = [
  { value: 'allow', label: 'Allow' },
  { value: 'ask', label: 'Ask' },
  { value: 'never', label: 'Never' },
]

describe('SegmentedControl', () => {
  it('is a labelled radio group with the selected option checked', () => {
    render(
      <SegmentedControl label="Set attribute" options={OPTIONS} value="ask" onChange={vi.fn()} />
    )
    expect(screen.getByRole('radiogroup', { name: 'Set attribute' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Allow' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: 'Ask' })).toHaveAttribute('aria-checked', 'true')
  })

  it('reports the clicked option', async () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl label="Set attribute" options={OPTIONS} value="ask" onChange={onChange} />
    )
    await userEvent.click(screen.getByRole('radio', { name: 'Never' }))
    expect(onChange).toHaveBeenCalledWith('never')
  })

  it('moves the selection with the arrow keys', async () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl label="Set attribute" options={OPTIONS} value="ask" onChange={onChange} />
    )
    screen.getByRole('radio', { name: 'Ask' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith('never')
  })

  it('steps from the option in hand when a second key is pressed before the value prop updates', async () => {
    const onChange = vi.fn()
    // The parent persists the change asynchronously, so `value` stays put.
    render(
      <SegmentedControl label="Set attribute" options={OPTIONS} value="allow" onChange={onChange} />
    )
    screen.getByRole('radio', { name: 'Allow' }).focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(onChange.mock.calls.map(([next]) => next)).toEqual(['ask', 'never'])
    await userEvent.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('ask')
  })
})
