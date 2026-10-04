// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PlanNoticeBanner } from '../plan-notice-banner'

const ENDED = {
  label: 'Pro trial ended',
  message: 'Your trial has come to an end.',
  expiresAt: '2026-08-18T00:00:00.000Z',
  actionLabel: 'Update billing',
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
    expect(screen.getByRole('link', { name: /Update billing/ })).toHaveAttribute(
      'href',
      '/admin/settings/billing'
    )
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
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
