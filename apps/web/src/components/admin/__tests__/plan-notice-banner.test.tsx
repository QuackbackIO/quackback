// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PlanNoticeBanner } from '../plan-notice-banner'

const ENDED = {
  label: 'Pro trial ended',
  message: 'Upgrade to Pro to keep everything, or downgrade to Free.',
  expiresAt: '2026-08-18T00:00:00.000Z',
  actionLabel: 'Compare plans',
  actionUrl: '/admin/settings/billing',
  ended: true,
}

const OPERATOR = {
  label: 'Scheduled maintenance',
  message: 'Back at 09:00 UTC',
}

describe('PlanNoticeBanner', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders an ended-trial strip with no dismiss control', () => {
    render(<PlanNoticeBanner notice={ENDED} />)
    expect(screen.getByText('Pro trial ended')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Compare plans/ })).toHaveAttribute(
      'href',
      '/admin/settings/billing'
    )
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
  })

  it('names no deadline: an ended trial holds nothing back', () => {
    render(<PlanNoticeBanner notice={ENDED} />)
    expect(screen.queryByText(/Choose by/)).not.toBeInTheDocument()
  })

  it('shows a teammate who cannot choose a quiet strip with no button', () => {
    const { container } = render(
      <PlanNoticeBanner
        notice={{
          label: 'Pro trial ended',
          message: 'Ask someone who manages billing to upgrade. Until then, Free limits apply.',
          expiresAt: ENDED.expiresAt,
          ended: true,
        }}
      />
    )
    expect(screen.getByText('Pro trial ended')).toBeInTheDocument()
    // Its message is all it has to say, so it is not hidden on a phone.
    expect(screen.getByText(/Ask someone who manages billing to upgrade/).className).not.toMatch(
      /hidden/
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(container.firstElementChild?.className).not.toMatch(/bg-red-600/)
  })

  it('renders a self-host operator notice', () => {
    render(<PlanNoticeBanner notice={OPERATOR} />)
    expect(screen.getByText('Scheduled maintenance')).toBeInTheDocument()
  })

  it('waits for the last three days of a trial before it shows', () => {
    const days = (n: number) => ({
      label: 'Pro trial',
      message: 'When it ends, upgrade to keep everything, or downgrade to Free.',
      expiresAt: new Date(Date.now() + n * 86_400_000 - 60_000).toISOString(),
      actionLabel: 'Compare plans',
      actionUrl: '/admin/settings/billing',
    })
    render(<PlanNoticeBanner notice={days(14)} />)
    expect(screen.queryByText('Pro trial')).not.toBeInTheDocument()
    cleanup()
    render(<PlanNoticeBanner notice={days(3)} />)
    expect(screen.getByText('Pro trial')).toBeInTheDocument()
  })
})
