// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import type { PlanLimitsPage } from '@/lib/server/domains/plan-limits/plan-limits.page'
import type { PlanLimitsNotice } from '@/lib/server/domains/plan-limits/plan-limits.notice'
import { PLAN_LIMITS_PATH } from '@/lib/shared/billing/plan-limits-path'

vi.mock('@/lib/client/queries/plan-limits', () => ({
  planLimitsQueries: { all: ['plan-limits'] },
}))

const { PlanLimitsBanner, PlanLimitsQuiet } = await import('../plan-limits-banner')

// The dates below are in the same year as this clock, so they show no year.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const boards = {
  key: 'maxBoards' as const,
  used: 5,
  cap: 1,
  message: 'You have 5 out of 1 boards',
  actionLabel: 'Remove 4 boards',
  href: '/admin/settings/boards',
}
const seats = {
  key: 'maxTeamSeats' as const,
  used: 3,
  cap: 1,
  message: 'You have 3 out of 1 seats',
  actionLabel: 'Remove 2 seats',
  href: '/admin/settings/members',
}
const webhooks = { key: 'webhooks' as const, count: 1, label: 'Webhooks', href: '/x' }

function limits(over: Partial<PlanLimitsPage> = {}): PlanLimitsPage {
  return {
    enabled: true,
    phase: 'grace',
    plan: 'free',
    since: '2026-11-18T12:00:00.000Z',
    graceEndsAt: '2026-11-25T12:00:00.000Z',
    deadlineDay: '2026-11-24',
    fromPlan: 'pro',
    issues: [boards, seats],
    fixedIssues: [],
    infoRows: [],
    featureIssues: [webhooks],
    openBoardIds: null,
    keptBoardId: null,
    seatHolderIds: null,
    visibleStatusComponentIds: null,
    sendingDomainIds: null,
    planName: 'Free',
    fromPlanName: 'Pro',
    choosers: { board: true, seats: true, statusComponents: false, sendingDomains: false },
    candidates: {},
    lockedSeatHolderIds: [],
    canManageBilling: true,
    ...over,
  }
}

const banner = () => document.querySelector('[data-plan-limits-banner]')

describe('PlanLimitsBanner', () => {
  it('renders nothing when the workspace fits its plan', () => {
    render(<PlanLimitsBanner limits={limits({ phase: 'ok', issues: [] })} pathname="/admin" />)
    expect(banner()).toBeNull()
  })

  it('renders nothing without plan billing, whatever the rest says', () => {
    render(<PlanLimitsBanner limits={limits({ enabled: false })} pathname="/admin" />)
    expect(banner()).toBeNull()
  })

  it('renders nothing before the state loads', () => {
    render(<PlanLimitsBanner limits={undefined} pathname="/admin" />)
    expect(banner()).toBeNull()
  })

  it('during grace is amber, with the count, the date and the plan to keep', () => {
    render(<PlanLimitsBanner limits={limits()} pathname="/admin" />)
    expect(banner()).toHaveAttribute('data-plan-limits-banner', 'grace')
    expect(banner()?.className).toMatch(/bg-warning\/10/)
    expect(banner()?.className).toMatch(/border-warning\/40/)
    expect(banner()?.querySelector('[data-plan-limits-icon]')?.getAttribute('class')).toMatch(
      /text-warning/
    )
    expect(screen.getByText("Your workspace is over the Free plan's limits.")).toBeInTheDocument()
    expect(
      screen.getByText(/^Fix 2 issues by Nov 24, or upgrade to keep everything\.$/)
    ).toBeInTheDocument()
    const review = screen.getByRole('link', { name: 'Review issues' })
    expect(review).toHaveAttribute('href', PLAN_LIMITS_PATH)
    expect(review.className).toMatch(/text-warning/)
  })

  it('once enforced is red and says what is paused', () => {
    render(<PlanLimitsBanner limits={limits({ phase: 'enforced' })} pathname="/admin" />)
    expect(banner()).toHaveAttribute('data-plan-limits-banner', 'enforced')
    expect(banner()?.className).toMatch(/bg-destructive\/15/)
    expect(banner()?.className).not.toMatch(/bg-warning/)
    expect(banner()?.querySelector('[data-plan-limits-icon]')?.getAttribute('class')).toMatch(
      /text-destructive/
    )
    expect(screen.getByText("Your workspace is over the Free plan's limits.")).toBeInTheDocument()
    expect(
      screen.getByText(
        '4 boards are read-only and 2 teammates have no admin access. 1 more thing is paused. They come back when you upgrade.'
      )
    ).toBeInTheDocument()
    cleanup()
    render(
      <PlanLimitsBanner
        limits={limits({
          phase: 'enforced',
          featureIssues: [
            webhooks,
            { key: 'customCss', count: 1, label: 'Custom CSS', href: '/x' },
          ],
        })}
        pathname="/admin"
      />
    )
    expect(
      screen.getByText(
        '4 boards are read-only and 2 teammates have no admin access. 2 more things are paused. They come back when you upgrade.'
      )
    ).toBeInTheDocument()
    cleanup()
    render(
      <PlanLimitsBanner
        limits={limits({ phase: 'enforced', issues: [boards] })}
        pathname="/admin"
      />
    )
    expect(
      screen.getByText(
        '4 boards are read-only and webhooks are paused. They come back when you upgrade.'
      )
    ).toBeInTheDocument()
  })

  it('goes quiet once only paused features remain after the date', () => {
    render(
      <PlanLimitsBanner limits={limits({ phase: 'enforced', issues: [] })} pathname="/admin" />
    )
    expect(banner()).toBeNull()
  })

  it('asks a teammate without billing rights to ask someone who manages billing', () => {
    render(<PlanLimitsBanner limits={limits({ canManageBilling: false })} pathname="/admin" />)
    expect(
      screen.getByText('Fix 2 issues by Nov 24. Ask someone who manages billing to upgrade.')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review issues' })).toHaveAttribute(
      'href',
      PLAN_LIMITS_PATH
    )
    expect(screen.queryByText(/keep everything|owner/)).not.toBeInTheDocument()
  })

  it('is hidden on the Plan limits page itself', () => {
    render(<PlanLimitsBanner limits={limits()} pathname={PLAN_LIMITS_PATH} />)
    expect(banner()).toBeNull()
    cleanup()
    render(<PlanLimitsBanner limits={limits()} pathname="/admin/settings/billing" />)
    expect(banner()).not.toBeNull()
  })
})

describe('PlanLimitsQuiet', () => {
  const mount = (value: PlanLimitsPage, locale = 'en', messages: Record<string, string> = en) =>
    render(
      <IntlProvider locale={locale} messages={messages}>
        <PlanLimitsQuiet limits={value} />
      </IntlProvider>
    )

  it('shows the plan, what is left to fix and the date', () => {
    mount(limits())
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', PLAN_LIMITS_PATH)
    expect(link).toHaveTextContent('Free plan · 2 issues')
    expect(link).toHaveTextContent(/Fix by Nov 24$/)
  })

  it('says what is paused once enforced, and nothing when it fits or without plan billing', () => {
    mount(limits({ phase: 'enforced' }))
    expect(screen.getByRole('link')).toHaveTextContent(/Paused since Nov 25$/)
    cleanup()
    mount(limits({ phase: 'ok' }))
    expect(screen.queryByRole('link')).toBeNull()
    cleanup()
    mount(limits({ enabled: false }))
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('goes quiet with the banner once only paused features remain after the date', () => {
    mount(limits({ phase: 'enforced', issues: [] }))
    expect(screen.queryByRole('link')).toBeNull()
    cleanup()
    // Before the date, features alone still show, with the day they pause.
    mount(limits({ issues: [] }))
    expect(screen.getByRole('link')).toHaveTextContent(/^Free planFix by Nov 24$/)
  })

  it('needs no message catalogue, so nothing is seeded for it', () => {
    render(<PlanLimitsQuiet limits={limits()} />)
    expect(screen.getByRole('link')).toHaveTextContent('Free plan · 2 issues')
  })
})

describe('for a viewer who cannot open the Plan limits page', () => {
  const narrowed = (over: Partial<PlanLimitsNotice> = {}): PlanLimitsNotice => ({
    canViewPage: false,
    enabled: true,
    phase: 'enforced',
    graceEndsAt: '2026-11-25T12:00:00.000Z',
    deadlineDay: '2026-11-24',
    planName: 'Free',
    fromPlanName: 'Pro',
    canManageBilling: false,
    issues: [{ key: 'maxBoards', used: 5, cap: 1 }],
    withheldIssues: ['maxTeamSeats'],
    featureIssues: [],
    ...over,
  })

  it('says teammates lost access without counting them, and links nowhere', () => {
    render(<PlanLimitsBanner limits={narrowed()} pathname="/admin" />)
    expect(
      screen.getByText(
        '4 boards are read-only and some teammates have no admin access. Ask someone who manages billing to upgrade.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('still shows when only withheld caps are over after the date', () => {
    render(<PlanLimitsBanner limits={narrowed({ issues: [] })} pathname="/admin" />)
    expect(banner()).toHaveAttribute('data-plan-limits-banner', 'enforced')
    expect(screen.getByText(/^Some teammates have no admin access\./)).toBeInTheDocument()
  })

  it('sends a billing manager to compare plans', () => {
    render(<PlanLimitsBanner limits={narrowed({ canManageBilling: true })} pathname="/admin" />)
    expect(screen.getByRole('link', { name: 'Compare plans' })).toHaveAttribute(
      'href',
      '/admin/settings/billing'
    )
  })

  it('counts every issue in the sidebar line, as plain text or a link to the plans', () => {
    render(<PlanLimitsQuiet limits={narrowed({ phase: 'grace' })} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Free plan · 2 issues')).toBeInTheDocument()
    expect(screen.getByText('Fix by Nov 24')).toBeInTheDocument()
    cleanup()
    render(<PlanLimitsQuiet limits={narrowed({ phase: 'grace', canManageBilling: true })} />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/admin/settings/billing')
  })
})
