// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SeatGatePanel } from '../seat-gate-panel'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

describe('SeatGatePanel', () => {
  it('shows Add a seat when the purchase path is available', () => {
    const onAddSeat = vi.fn()
    render(
      <SeatGatePanel
        usage={{ used: 10, limit: 10, addSeatAvailable: true }}
        onAddSeat={onAddSeat}
      />
    )
    expect(screen.getByText(/All 10 seats are in use/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a seat' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10')
  })

  it('routes to Plans on Free or without billing permission', () => {
    render(<SeatGatePanel usage={{ used: 1, limit: 1, addSeatAvailable: false }} />)
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute(
      'href',
      '/admin/settings/billing'
    )
    expect(screen.queryByRole('button', { name: 'Add a seat' })).not.toBeInTheDocument()
  })
})
