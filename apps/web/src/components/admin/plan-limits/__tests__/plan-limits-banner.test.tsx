// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import de from '@/locales/de.json'
import type { PlanLimitsPage } from '@/lib/server/domains/plan-limits/plan-limits.page'

vi.mock('@/lib/client/queries/plan-limits', () => ({
  planLimitsQueries: { all: ['plan-limits'] },
}))

const { PlanLimitsBanner, PlanLimitsQuiet, PLAN_LIMITS_PATH } =
  await import('../plan-limits-banner')

afterEach(cleanup)

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

  it('renders nothing with the flag off, whatever the rest says', () => {
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
    expect(screen.getByText('Over the Free plan limits.')).toBeInTheDocument()
    expect(
      screen.getByText(/^Fix 2 things by Wed, Nov 25, or keep everything on Pro\.$/)
    ).toBeInTheDocument()
    const review = screen.getByRole('link', { name: 'Review 2 issues' })
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
    expect(screen.getByText('Paused on the Free plan.')).toBeInTheDocument()
    expect(
      screen.getByText(
        '4 boards are read-only, 2 teammates are paused and more. Upgrade to bring them back.'
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
        '4 boards are read-only and webhooks are paused. Upgrade to bring them back.'
      )
    ).toBeInTheDocument()
  })

  it('goes quiet once only paused features remain after the date', () => {
    render(
      <PlanLimitsBanner limits={limits({ phase: 'enforced', issues: [] })} pathname="/admin" />
    )
    expect(banner()).toBeNull()
  })

  it('tells a teammate without billing rights that an owner needs to choose', () => {
    render(<PlanLimitsBanner limits={limits({ canManageBilling: false })} pathname="/admin" />)
    expect(screen.getByText('An owner needs to choose a plan by Wed, Nov 25.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: "See what's affected" })).toHaveAttribute(
      'href',
      PLAN_LIMITS_PATH
    )
    expect(screen.queryByText(/keep everything/)).not.toBeInTheDocument()
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
  const mount = (value: PlanLimitsPage, locale = 'en', messages = en) =>
    render(
      <IntlProvider locale={locale} messages={messages}>
        <PlanLimitsQuiet limits={value} />
      </IntlProvider>
    )

  it('shows the plan, what is left to fix and the date', () => {
    mount(limits())
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', PLAN_LIMITS_PATH)
    expect(link).toHaveTextContent('Free plan · 2 to fix')
    expect(link).toHaveTextContent(/Fix by Wed, Nov 25/)
  })

  it('says what is paused once enforced, and nothing when it fits or the flag is off', () => {
    mount(limits({ phase: 'enforced' }))
    expect(screen.getByRole('link')).toHaveTextContent(/Paused since/)
    cleanup()
    mount(limits({ phase: 'ok' }))
    expect(screen.queryByRole('link')).toBeNull()
    cleanup()
    mount(limits({ enabled: false }))
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('words the line in the viewer language', () => {
    mount(limits(), 'de', de)
    expect(screen.getByRole('link')).not.toHaveTextContent('to fix')
  })
})
