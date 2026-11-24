// @vitest-environment happy-dom
/**
 * The plan limits day reads the same for every viewer: the last full day to
 * fix is a plain UTC calendar date, never moved into the viewer's zone, so it
 * names the same day from UTC-12 to UTC+14. The year shows only when the day
 * falls in another year. The banner, the sidebar line, the Plan limits page
 * and the billing usage card all say it the same way.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'
import type { PlanLimitsPage } from '@/lib/server/domains/plan-limits/plan-limits.page'
import { overLimits } from './plan-limits-fixtures'

vi.mock('@/lib/server/functions/plan-limits', () => ({
  getPlanLimitsFn: vi.fn(),
  getPlanLimitsSummaryFn: vi.fn(async () => null),
  setKeptBoardFn: vi.fn(),
  setSeatHoldersFn: vi.fn(),
  setVisibleStatusComponentsFn: vi.fn(),
  setKeptSendingDomainsFn: vi.fn(),
}))

const { PlanLimitsBanner, PlanLimitsQuiet } =
  await import('@/components/admin/plan-limits/plan-limits-banner')
const { PlanLimitsView } = await import('../plan-limits-view')
const { BillingPlansView } = await import('../billing-settings')

const originalTz = process.env.TZ

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

const overview: BillingProjectionOverview = {
  plan: 'free',
  planName: 'Free',
  status: null,
  trialActive: false,
  trialExpiresAt: null,
  renewalAt: null,
  cancellationAt: null,
  canUpgrade: true,
  canManageBilling: true,
  purchasablePlans: [],
  seats: { used: 3, pending: 0, members: 3, purchased: null },
  ai: null,
  hideBranding: false,
}

function renderAll(limits: PlanLimitsPage) {
  render(
    <IntlProvider locale="en" messages={{}}>
      <QueryClientProvider client={new QueryClient()}>
        <PlanLimitsBanner limits={limits} pathname="/admin" />
        <PlanLimitsQuiet limits={limits} />
        <PlanLimitsView limits={limits} permissions={new Set()} catalogue={null} />
        <BillingPlansView
          overview={overview}
          catalogue={null}
          catalogueError={null}
          invoices={[]}
          invoicesError={null}
          usage={[{ key: 'maxBoards', label: 'boards', used: 3, limit: 1 }]}
          limits={limits}
        />
      </QueryClientProvider>
    </IntlProvider>
  )
}

const bannerText = () => document.querySelector('[data-plan-limits-banner]')?.textContent ?? ''
const quietText = () => document.querySelector('[data-plan-limits-quiet]')?.textContent ?? ''
const deadline = () =>
  within(document.querySelector('[data-plan-limits-deadline]') as HTMLElement).getByRole('heading')

describe('the plan limits day across time zones', () => {
  it('is the UTC calendar date in every zone the clock really moves to', () => {
    for (const zone of ['Pacific/Kiritimati', 'Etc/GMT+12', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = zone
      // The zone really changed in this worker, so a date left in the viewer's
      // zone would move: noon UTC on the 24th is the 25th in Kiritimati.
      if (zone === 'Pacific/Kiritimati') {
        expect(new Date('2026-11-24T12:00:00.000Z').getDate()).toBe(25)
      }
      renderAll(overLimits())
      expect(bannerText()).toContain('Fix 4 issues by Nov 24, or upgrade to keep everything.')
      expect(quietText()).toMatch(/Fix by Nov 24$/)
      expect(deadline()).toHaveTextContent(/^Fix by Tue, Nov 24$/)
      expect(screen.getByRole('heading', { name: 'Pauses after Nov 24' })).toBeInTheDocument()
      expect(screen.getByText('3 of 1 · fix by Nov 24')).toBeInTheDocument()
      cleanup()
    }
  })

  it('after the date, names the day things paused, in UTC', () => {
    process.env.TZ = 'Pacific/Kiritimati'
    vi.setSystemTime(new Date('2026-11-26T12:00:00.000Z'))
    renderAll(overLimits({ phase: 'enforced' }))
    expect(quietText()).toMatch(/Paused since Nov 25$/)
    expect(deadline()).toHaveTextContent(/^Paused since Wed, Nov 25$/)
  })
})

describe('the plan limits day across a new year', () => {
  const january = overLimits({
    since: '2026-12-27T12:00:00.000Z',
    graceEndsAt: '2027-01-03T12:00:00.000Z',
    deadlineDay: '2027-01-02',
  })

  it('shows the year when the day falls in the next year', () => {
    vi.setSystemTime(new Date('2026-12-28T09:00:00.000Z'))
    renderAll(january)
    expect(bannerText()).toContain('Fix 4 issues by Jan 2, 2027, or upgrade')
    expect(quietText()).toMatch(/Fix by Jan 2, 2027$/)
    expect(deadline()).toHaveTextContent(/^Fix by Sat, Jan 2, 2027$/)
    expect(screen.getByText('3 of 1 · fix by Jan 2, 2027')).toBeInTheDocument()
  })

  it('leaves the year out once that year has come', () => {
    vi.setSystemTime(new Date('2027-01-01T09:00:00.000Z'))
    renderAll(january)
    expect(bannerText()).toContain('Fix 4 issues by Jan 2, or upgrade')
    expect(deadline()).toHaveTextContent(/^Fix by Sat, Jan 2$/)
  })

  it('shows the year of a pause that began last year', () => {
    vi.setSystemTime(new Date('2027-01-05T09:00:00.000Z'))
    renderAll(
      overLimits({
        phase: 'enforced',
        since: '2026-12-23T12:00:00.000Z',
        graceEndsAt: '2026-12-30T12:00:00.000Z',
        deadlineDay: '2026-12-29',
      })
    )
    expect(quietText()).toMatch(/Paused since Dec 30, 2026$/)
    expect(deadline()).toHaveTextContent(/^Paused since Wed, Dec 30, 2026$/)
  })
})

describe('the countdown on the Plan limits page', () => {
  it.each([
    ['2026-11-18T12:00:00.000Z', '7 days left'],
    ['2026-11-23T12:00:00.000Z', '2 days left'],
    ['2026-11-24T13:00:00.000Z', '1 day left'],
    ['2026-11-25T12:00:00.000Z', 'Last day'],
  ])('at %s says %s, counted from when things pause', (now, label) => {
    vi.setSystemTime(new Date(now))
    renderAll(overLimits())
    const card = document.querySelector('[data-plan-limits-deadline="grace"]') as HTMLElement
    expect(card).toHaveTextContent(label)
  })
})
