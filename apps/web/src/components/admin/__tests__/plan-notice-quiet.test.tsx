// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, expect, it } from 'vitest'
import en from '@/locales/en.json'
import de from '@/locales/de.json'
import { PlanNoticeQuiet } from '../plan-notice-banner'

afterEach(cleanup)

const trial = (days: number) => ({
  label: 'Pro trial',
  expiresAt: new Date(Date.now() + days * 86_400_000 - 60_000).toISOString(),
  actionUrl: '/admin/settings/billing',
})

function mount(notice: Parameters<typeof PlanNoticeQuiet>[0]['notice']) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <PlanNoticeQuiet notice={notice} />
    </IntlProvider>
  )
}

it('shows a running trial quietly until its last three days', () => {
  mount(trial(14))
  expect(screen.getByRole('link', { name: 'Pro trial · 14 days' })).toHaveAttribute(
    'href',
    '/admin/settings/billing'
  )
  cleanup()
  mount(trial(3))
  expect(screen.queryByText(/Pro trial/)).not.toBeInTheDocument()
  cleanup()
  mount({ label: 'Scheduled maintenance' })
  expect(screen.queryByText(/Scheduled/)).not.toBeInTheDocument()
})

it('words the trial line in the viewer language', () => {
  render(
    <IntlProvider locale="de" messages={de}>
      <PlanNoticeQuiet notice={{ ...trial(14), trialPlan: 'Pro' }} />
    </IntlProvider>
  )
  expect(screen.getByRole('link', { name: 'Pro-Testphase · 14 Tage' })).toBeInTheDocument()
})
