// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { PlanLimitsPage } from '@/lib/server/domains/plan-limits/plan-limits.page'
import { overLimits } from './plan-limits-fixtures'

const hoisted = vi.hoisted(() => ({
  setKeptBoardFn: vi.fn(),
  setSeatHoldersFn: vi.fn(),
  setVisibleStatusComponentsFn: vi.fn(),
  setKeptSendingDomainsFn: vi.fn(),
  getPlanLimitsSummaryFn: vi.fn(),
  getPlanLimitsFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/plan-limits', () => hoisted)

const { PlanLimitsView, keepEverythingPlan } = await import('../plan-limits-view')
const { planLimitsQueries } = await import('@/lib/client/queries/plan-limits')

afterEach(cleanup)
beforeEach(() => {
  for (const fn of Object.values(hoisted)) fn.mockReset()
  hoisted.getPlanLimitsSummaryFn.mockResolvedValue(null)
})

const BILLING: PermissionKey[] = [PERMISSIONS.BILLING_MANAGE]

/** Reads the summary the banner reads, so a chooser's refresh is visible. */
function SummaryProbe() {
  useQuery(planLimitsQueries.summary())
  return null
}

function mount(limits: PlanLimitsPage, permissions: PermissionKey[] = BILLING) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SummaryProbe />
      <PlanLimitsView limits={limits} permissions={new Set(permissions)} catalogue={null} />
    </QueryClientProvider>
  )
  return client
}

const row = (key: string) => document.querySelector(`[data-plan-limit-row="${key}"]`) as HTMLElement

describe('PlanLimitsView', () => {
  it('shows the deadline, the countdown and how much is fixed', () => {
    mount(overLimits())
    const card = document.querySelector('[data-plan-limits-deadline="grace"]') as HTMLElement
    expect(within(card).getByRole('heading')).toHaveTextContent(/^Fix by Tue, Nov 24$/)
    expect(card).toHaveTextContent('1 of 5 fixed')
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    // The upgrade is in the card too on a phone, where the plan aside sits at the bottom.
    expect(within(card).getByRole('link', { name: 'Upgrade to Pro' }).className).toMatch(
      /lg:hidden/
    )
    cleanup()
    // No empty grey bar before the first fix; the count still shows.
    mount(overLimits({ fixedIssues: [] }))
    const fresh = document.querySelector('[data-plan-limits-deadline="grace"]') as HTMLElement
    expect(within(fresh).queryByRole('progressbar')).toBeNull()
    expect(fresh).toHaveTextContent('0 of 4 fixed')
  })

  it('renders each row type: over with fixes, fixed with a check, information with no fix', () => {
    mount(overLimits())
    expect(row('maxBoards')).toHaveAttribute('data-status', 'over')
    expect(row('maxBoards')).toHaveTextContent('3 of 1')
    expect(row('maxBoards')).toHaveTextContent(
      'After Nov 24, 2 boards become read-only. Their posts stay visible.'
    )
    // An over bar is destructive on a destructive tint, never the brand colour.
    const bar = within(row('maxBoards')).getByRole('progressbar')
    expect(bar).toHaveAttribute('data-tone', 'over')
    expect(bar.className).toMatch(/bg-destructive\/15/)
    expect(bar.firstElementChild).toHaveAttribute('data-level', 'over')
    expect(bar.firstElementChild?.className).toMatch(/\bbg-destructive\b/)
    expect(bar.firstElementChild?.className).not.toMatch(/bg-primary/)
    expect(
      within(row('maxBoards')).getByRole('button', { name: 'Choose which board stays open' })
    ).toBeInTheDocument()
    // The choosers are secondary; the page's one primary is the upgrade.
    const choose = within(row('maxBoards')).getByRole('button', {
      name: 'Choose which board stays open',
    })
    expect(choose.className).not.toMatch(/\bbg-primary\b/)
    expect(choose.closest('[data-plan-limit-actions]')).not.toBeNull()

    expect(row('maxSendingDomains')).toHaveAttribute('data-status', 'fixed')
    expect(row('maxSendingDomains')).toHaveTextContent('Fixed.')
    expect(within(row('maxSendingDomains')).queryByRole('button')).toBeNull()

    expect(row('maxPosts')).toHaveAttribute('data-status', 'info')
    expect(row('maxPosts')).toHaveTextContent('New posts stop at 50. Existing posts stay.')
    expect(within(row('maxPosts')).queryByRole('progressbar')).toBeNull()
    expect(within(row('maxSendingDomains')).queryByRole('progressbar')).toBeNull()
    expect(within(row('maxPosts')).queryByRole('button')).toBeNull()
    expect(within(row('maxPosts')).queryByRole('link')).toBeNull()
  })

  it('lists what pauses on the date, and what keeps working', () => {
    mount(overLimits())
    expect(screen.getByRole('heading', { name: 'Pauses after Nov 24' })).toBeInTheDocument()
    // Each paused feature is one whole-row link to where it is set up.
    const feature = document.querySelector('[data-plan-limit-feature="webhooks"]') as HTMLElement
    const link = within(feature).getByRole('link')
    expect(link).toHaveAttribute('href', '/admin/settings/developers')
    expect(link).toHaveTextContent('WebhooksDeliveries to 1 endpoint pause.')
    expect(screen.getByRole('heading', { name: 'Not affected' })).toBeInTheDocument()
    const keeps = document.querySelector('[data-plan-limits-keeps]') as HTMLElement
    expect(within(keeps).getByText('All posts, votes and comments')).toBeInTheDocument()
    expect(keeps.className).toMatch(/sm:grid-cols-2/)
  })

  it('moves to the past tense after the date', () => {
    mount(overLimits({ phase: 'enforced' }))
    expect(screen.getByRole('heading', { name: 'Paused' })).toBeInTheDocument()
    expect(screen.queryByText(/Pauses after/)).toBeNull()
    expect(row('maxBoards')).toHaveTextContent('2 boards are read-only.')
    expect(document.querySelector('[data-plan-limit-feature="webhooks"]')).toHaveTextContent(
      'Paused on the Free plan.'
    )
    expect(document.querySelector('[data-plan-limits-deadline="enforced"]')).toHaveTextContent(
      /Paused since Wed, Nov 25/
    )
  })

  it('offers the plan that keeps everything with the checkout, for a billing manager', () => {
    mount(overLimits())
    const aside = document.querySelector('[data-plan-limits-keep="pro"]') as HTMLElement
    expect(within(aside).getByRole('link', { name: 'Upgrade to Pro' })).toHaveAttribute(
      'href',
      expect.stringContaining('/admin/settings/billing/checkout')
    )
    expect(within(aside).getByRole('link', { name: 'Compare plans' })).toBeInTheDocument()
    // What the plan keeps, from the rows on the page: no custom roles line,
    // since Pro includes none.
    const lines = [...aside.querySelectorAll('[data-plan-limits-keep-lines] li')].map(
      (li) => li.textContent
    )
    expect(lines).toEqual([
      'Unlimited boards and posts',
      'Up to 5 team seats',
      'Up to 10 status components',
      'Webhooks',
    ])
  })

  it('shows a teammate without billing rights only the fixes they may make, and asks for an owner', () => {
    mount(
      overLimits({
        canManageBilling: false,
        choosers: { board: true, seats: false, statusComponents: false, sendingDomains: false },
      }),
      [PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.BOARD_MANAGE]
    )
    expect(
      within(row('maxBoards')).getByRole('button', { name: /Choose which board/ })
    ).toBeVisible()
    expect(within(row('maxBoards')).getByRole('link', { name: 'Manage boards' })).toBeVisible()
    expect(within(row('maxTeamSeats')).queryByRole('button')).toBeNull()
    expect(within(row('maxTeamSeats')).queryByRole('link')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Upgrade to Pro' })).toBeNull()
    expect(screen.getByText('Ask someone who manages billing to upgrade.')).toBeInTheDocument()
  })

  it('says the workspace fits when nothing is over, and when the flag is off', () => {
    mount(overLimits({ phase: 'ok', issues: [], graceEndsAt: null, deadlineDay: null }))
    expect(screen.getByText('Your workspace fits the Free plan.')).toBeInTheDocument()
    cleanup()
    mount(overLimits({ enabled: false }))
    expect(screen.getByText('Your workspace fits the Free plan.')).toBeInTheDocument()
    expect(document.querySelector('[data-plan-limit-issues]')).toBeNull()
  })
})

describe('keepEverythingPlan', () => {
  it('is the plan before the drop when higher, else the next plan up', () => {
    expect(keepEverythingPlan('free', 'business')).toBe('business')
    expect(keepEverythingPlan('free', null)).toBe('pro')
    expect(keepEverythingPlan('pro', 'free')).toBe('business')
    expect(keepEverythingPlan('enterprise', null)).toBeNull()
    expect(keepEverythingPlan(null, 'pro')).toBeNull()
  })
})

describe('choosers', () => {
  it('keeps the chosen board, defaulting to the current one, and refreshes every surface', async () => {
    hoisted.setKeptBoardFn.mockResolvedValue({ ok: true })
    mount(overLimits())
    await waitFor(() => expect(hoisted.getPlanLimitsSummaryFn).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Choose which board stays open' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Keep Feature requests open' })).toBeVisible()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Bugs' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep Bugs open' }))
    await waitFor(() =>
      expect(hoisted.setKeptBoardFn).toHaveBeenCalledWith({ data: { boardId: 'board_b' } })
    )
    await waitFor(() => expect(hoisted.getPlanLimitsSummaryFn).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps the owner seat locked and sends the whole choice', async () => {
    hoisted.setSeatHoldersFn.mockResolvedValue({ ok: true })
    mount(overLimits())
    fireEvent.click(screen.getByRole('button', { name: 'Choose who keeps a seat' }))
    const dialog = await screen.findByRole('dialog')
    const owner = within(dialog).getByRole('checkbox', { name: 'Ada Owner' })
    expect(owner).toBeDisabled()
    expect(owner).toHaveAttribute('aria-checked', 'true')
    expect(within(dialog).getByRole('checkbox', { name: 'Cy Quiet' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Bea Recent' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Cy Quiet' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(hoisted.setSeatHoldersFn).toHaveBeenCalledWith({
        data: { ids: ['p_owner', 'p_quiet'] },
      })
    )
  })

  it('picks the status components that show', async () => {
    hoisted.setVisibleStatusComponentsFn.mockResolvedValue({ ok: true })
    mount(overLimits())
    fireEvent.click(screen.getByRole('button', { name: 'Choose what shows on your status page' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Portal' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Email' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(hoisted.setVisibleStatusComponentsFn).toHaveBeenCalledWith({
        data: { ids: ['c1', 'c3', 'c4'] },
      })
    )
  })

  it('keeps one sending domain on a plan that includes one', async () => {
    hoisted.setKeptSendingDomainsFn.mockResolvedValue({ ok: true })
    const limits = overLimits({
      issues: [
        {
          key: 'maxSendingDomains',
          used: 2,
          cap: 1,
          message: 'You have 2 out of 1 sending domains',
          actionLabel: 'Remove 1 sending domain',
          href: '/admin/settings/domains',
        },
      ],
      choosers: { board: false, seats: false, statusComponents: false, sendingDomains: true },
      sendingDomainIds: ['d_old'],
      candidates: {
        sendingDomains: [
          { id: 'd_old', domain: 'mail.example.com', status: 'verified', createdAt: '' },
          { id: 'd_new', domain: 'news.example.com', status: 'verified', createdAt: '' },
        ],
      },
    })
    mount(limits)
    fireEvent.click(screen.getByRole('button', { name: 'Choose which domain keeps sending' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'news.example.com' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(hoisted.setKeptSendingDomainsFn).toHaveBeenCalledWith({ data: { ids: ['d_new'] } })
    )
  })

  it('offers no domain chooser when the plan includes none', () => {
    mount(
      overLimits({
        issues: [
          {
            key: 'maxSendingDomains',
            used: 1,
            cap: 0,
            message: 'You have 1 out of 0 sending domains',
            actionLabel: 'Remove 1 sending domain',
            href: '/admin/settings/domains',
          },
        ],
        choosers: { board: false, seats: false, statusComponents: false, sendingDomains: true },
      })
    )
    expect(screen.queryByRole('button', { name: 'Choose which domain keeps sending' })).toBeNull()
  })

  it('shows a refusal inline and stays open', async () => {
    hoisted.setKeptBoardFn.mockResolvedValue({ ok: false, reason: 'not_over' })
    mount(overLimits())
    fireEvent.click(screen.getByRole('button', { name: 'Choose which board stays open' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep Feature requests open' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This fits the plan now, so there is nothing to choose.'
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
