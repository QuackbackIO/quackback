// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PlanNoticeBanner } from '../plan-notice-banner'

const ENDED = {
  label: 'Pro trial ended',
  message: 'Choose how this workspace continues: keep Pro, or switch to Free.',
  expiresAt: '2026-08-18T00:00:00.000Z',
  actionLabel: 'Choose a plan',
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
    expect(screen.getByRole('link', { name: /Choose a plan/ })).toHaveAttribute(
      'href',
      '/admin/settings/billing'
    )
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
  })

  it('says when the choice is due while the grace period runs', () => {
    const due = new Date(Date.now() + 36 * 3_600_000)
    render(<PlanNoticeBanner notice={{ ...ENDED, choiceDueAt: due.toISOString() }} />)
    expect(screen.getByText(/Choose by/)).toBeInTheDocument()
    expect(document.querySelector('time')).toHaveAttribute('dateTime', due.toISOString())
  })

  it('drops the deadline once it has passed', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    render(<PlanNoticeBanner notice={{ ...ENDED, choiceDueAt: past }} />)
    expect(screen.queryByText(/Choose by/)).not.toBeInTheDocument()
    expect(screen.getByText('Pro trial ended')).toBeInTheDocument()
  })

  it('shows a teammate who cannot choose a quiet strip with no button', () => {
    const { container } = render(
      <PlanNoticeBanner
        notice={{
          label: 'Pro trial ended',
          message: 'A workspace admin needs to choose a plan. Until then, Free limits apply.',
          expiresAt: ENDED.expiresAt,
          ended: true,
        }}
      />
    )
    expect(screen.getByText('Pro trial ended')).toBeInTheDocument()
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
      message: 'When this ends, pick a plan.',
      expiresAt: new Date(Date.now() + n * 86_400_000 - 60_000).toISOString(),
      actionLabel: 'See plans',
      actionUrl: '/admin/settings/billing',
    })
    render(<PlanNoticeBanner notice={days(14)} />)
    expect(screen.queryByText('Pro trial')).not.toBeInTheDocument()
    cleanup()
    render(<PlanNoticeBanner notice={days(3)} />)
    expect(screen.getByText('Pro trial')).toBeInTheDocument()
  })
})
