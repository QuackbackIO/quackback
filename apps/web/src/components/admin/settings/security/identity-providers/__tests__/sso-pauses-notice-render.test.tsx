// @vitest-environment happy-dom
/**
 * <SsoPausesNotice> shows only while single sign-on is set up past the plan
 * and the 7 days are running. The provider list mounts it whenever single
 * sign-on is live without the plan's flag, and the state it reads can be
 * newer than the page's own: once the deadline has passed (or nothing is
 * over, or plan billing is off) it must say nothing rather than name a day
 * that has gone.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SsoPausesNotice, { SSO_NOTICE_QUERY_KEY } from '../sso-pauses-notice'

const getPlanLimitsFn = vi.hoisted(() => vi.fn(async () => null))
vi.mock('@/lib/server/functions/plan-limits', () => ({ getPlanLimitsFn }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

const GRACE = {
  enabled: true,
  phase: 'grace',
  planName: 'Free',
  graceEndsAt: '2026-11-23T00:00:00.000Z',
  deadlineDay: '2026-11-22',
  featureIssues: [{ key: 'sso' }],
  canManageBilling: true,
}

function renderWith(state: Record<string, unknown>) {
  const qc = new QueryClient()
  qc.setQueryData(SSO_NOTICE_QUERY_KEY, state)
  return render(
    <QueryClientProvider client={qc}>
      <SsoPausesNotice />
    </QueryClientProvider>
  )
}

describe('SsoPausesNotice', () => {
  it('names the last day during the 7 days', () => {
    renderWith(GRACE)
    expect(screen.getByText(/^Single sign-on pauses after Nov 22/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upgrade' })).toHaveAttribute(
      'href',
      '/admin/settings/billing'
    )
  })

  it.each([
    ['after the deadline', { phase: 'enforced' }],
    ['when nothing is over', { phase: 'ok' }],
    ['without plan billing', { enabled: false }],
    ['when single sign-on is not one of the issues', { featureIssues: [{ key: 'webhooks' }] }],
    ['without a deadline day', { deadlineDay: null }],
  ])('says nothing %s', (_label, over) => {
    const { container } = renderWith({ ...GRACE, ...over })
    expect(container).toBeEmptyDOMElement()
  })
})
