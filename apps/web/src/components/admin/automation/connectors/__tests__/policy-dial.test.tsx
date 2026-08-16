// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PolicyDial } from '../policy-dial'

describe('PolicyDial', () => {
  it('exposes the three mockup states as radios', async () => {
    const onChange = vi.fn()
    render(<PolicyDial value="approval" onChange={onChange} labelledBy="extend_trial" />)
    expect(screen.getByRole('radio', { name: 'Always allow' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(screen.getByRole('radio', { name: 'Needs approval' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await userEvent.click(screen.getByRole('radio', { name: 'Never' }))
    expect(onChange).toHaveBeenCalledWith('never')
  })
})
