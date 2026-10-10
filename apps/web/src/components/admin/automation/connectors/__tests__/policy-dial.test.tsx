// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PolicyDial } from '../policy-dial'

describe('PolicyDial', () => {
  it('labels the three policies Allow, Ask and Never', async () => {
    const onChange = vi.fn()
    render(<PolicyDial value="approval" onChange={onChange} labelledBy="extend_trial" />)
    expect(screen.getByRole('radiogroup', { name: 'extend_trial' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Allow' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: 'Ask' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('radio', { name: 'Never' }))
    expect(onChange).toHaveBeenCalledWith('never')
  })

  it('stores Allow as the always policy', async () => {
    const onChange = vi.fn()
    render(<PolicyDial value="never" onChange={onChange} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Allow' }))
    expect(onChange).toHaveBeenCalledWith('always')
  })
})
