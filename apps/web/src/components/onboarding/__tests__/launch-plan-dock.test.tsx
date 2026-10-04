// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import type { LaunchStatus } from '@/lib/shared/launch-checklist'

const hoisted = vi.hoisted(() => ({ fetches: 0, canView: true, role: 'admin' }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    onboardingStatus: () => ({
      queryKey: ['admin', 'onboarding'],
      queryFn: async () => {
        hoisted.fetches++
        throw new Error('the dock must not fetch the launch status')
      },
    }),
  },
}))
vi.mock('@/lib/client/hooks/use-permission', () => ({
  usePermission: (permission: string) => permission === 'member.view' && hoisted.canView,
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useSessionContext: () => ({ user: { id: 'user_acme' } }),
  useUserRole: () => hoisted.role,
}))

import { LaunchPlanDock } from '../launch-plan-dock'

const open: LaunchStatus = {
  hasBoards: true,
  hasPublicBoard: true,
  memberCount: 1,
  hasBranding: false,
  goals: ['product_feedback', 'customer_support', 'help_center'],
  features: {
    supportInbox: true,
    helpCenter: true,
    statusPage: false,
    integrations: true,
    assistant: false,
  },
}
// Every chore is done: the plan still waits for a customer.
const choresDone: LaunchStatus = {
  ...open,
  publicBoardLinkCopiedAt: '2026-10-03T10:00:00.000Z',
  hasWidgetInstalled: true,
  hasWidgetEnabled: true,
  hasHelpArticle: true,
  hasBranding: true,
  memberCount: 2,
}
const resolved: LaunchStatus = { ...choresDone, hasFirstWin: true }

function mount(cached?: LaunchStatus) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (cached) client.setQueryData(['admin', 'onboarding'], cached)
  return render(
    <IntlProvider locale="en" messages={en}>
      <QueryClientProvider client={client}>
        <LaunchPlanDock />
      </QueryClientProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  hoisted.fetches = 0
  hoisted.canView = true
  hoisted.role = 'admin'
})
afterEach(cleanup)

describe('launch plan dock', () => {
  it("is a plain link to the Launch plan page with the plan's one count", async () => {
    mount(open)
    const link = await screen.findByRole('link', { name: /Launch plan/ })
    expect(link).toHaveAttribute('href', '/admin/getting-started')
    expect(link).toHaveTextContent('Step 2 of 3')
    expect(screen.queryByRole('button')).toBeNull()
    expect(hoisted.fetches).toBe(0)
  })

  it('stays after a reload away from Home and never fetches on its own', async () => {
    mount(open)
    await screen.findByRole('link', { name: /Launch plan/ })
    cleanup()

    mount()
    const link = await screen.findByRole('link', { name: /Launch plan/ })
    expect(link).toHaveTextContent('Step 2 of 3')
    expect(hoisted.fetches).toBe(0)
  })

  it('stays while the chores are done but no customer has acted', async () => {
    mount(choresDone)
    const link = await screen.findByRole('link', { name: /Launch plan/ })
    expect(link).toHaveTextContent('Step 3 of 3')
  })

  it('hides once the plan is resolved, including after a reload', async () => {
    mount(open)
    await screen.findByRole('link', { name: /Launch plan/ })
    cleanup()

    mount(resolved)
    await waitFor(() => expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull())
    cleanup()

    mount()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
  })

  it('is absent for a teammate who is not an admin', async () => {
    hoisted.role = 'member'
    mount(open)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
  })

  it('is absent once the launch window has closed', async () => {
    mount({ ...open, inLaunchWindow: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
  })

  it('is absent for someone who cannot see the team', async () => {
    hoisted.canView = false
    mount(open)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('link', { name: /Launch plan/ })).toBeNull()
  })
})
