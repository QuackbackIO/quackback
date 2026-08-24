// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PlanNoticeBanner } from '../plan-notice-banner'

const ENDED = {
  label: 'Pro trial',
  message: "You're on the Free plan. Nothing was deleted.",
  expiresAt: '2026-08-18T00:00:00.000Z',
  actionLabel: 'Continue with Pro',
  actionUrl: '/admin/settings/billing',
  dismissible: true,
}

const OPERATOR = {
  label: 'Scheduled maintenance',
  message: 'Back at 09:00 UTC',
}

describe('PlanNoticeBanner', () => {
  afterEach(() => {
    cleanup()
  })

  it('still shows an operator notice after an ended-trial dismiss', async () => {
    const { rerender } = render(<PlanNoticeBanner notice={ENDED} />)
    expect(await screen.findByText('Pro trial')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Pro trial')).not.toBeInTheDocument()

    rerender(<PlanNoticeBanner notice={OPERATOR} />)
    expect(await screen.findByText('Scheduled maintenance')).toBeInTheDocument()
  })
})
