// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import type { LaunchStatus } from '@/lib/shared/launch-checklist'

const hoisted = vi.hoisted(() => ({
  status: null as unknown,
  resolutions: [] as unknown[],
  start: vi.fn(),
}))

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
      queryFn: async () => hoisted.status,
    }),
  },
}))
vi.mock('@/lib/server/functions/admin', () => ({
  setLaunchTaskResolutionFn: async (input: unknown) => {
    hoisted.resolutions.push(input)
    return { taskResolutions: {} }
  },
}))
vi.mock('@/lib/server/functions/activation', () => ({ markPublicBoardLinkCopiedFn: vi.fn() }))
vi.mock('@/lib/client/plg-events', () => ({ recordPlgEvent: vi.fn() }))
vi.mock('@/components/admin/settings/boards/create-board-dialog', () => ({
  CreateBoardDialog: () => null,
}))
vi.mock('../product-tour', () => ({ useProductTour: () => ({ start: hoisted.start }) }))

import { LaunchPlanPage } from '../launch-plan-page'

const AT = '2026-10-03T10:00:00.000Z'

const status: LaunchStatus = {
  hasBoards: true,
  hasPublicBoard: false,
  memberCount: 1,
  hasBranding: true,
  goals: ['product_feedback', 'customer_support'],
  useCase: 'product_feedback',
  taskResolutions: {
    product_feedback: { 'connect-integration': { resolution: 'dismissed', resolvedAt: AT } },
  },
  features: {
    supportInbox: true,
    helpCenter: false,
    statusPage: false,
    integrations: true,
    assistant: false,
    changelog: false,
  },
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['admin', 'onboarding'], hoisted.status)
  return render(
    <IntlProvider locale="en" messages={en}>
      <QueryClientProvider client={client}>
        <LaunchPlanPage />
      </QueryClientProvider>
    </IntlProvider>
  )
}

const row = (name: string) => screen.getByText(name).closest('li') as HTMLElement

beforeEach(() => {
  hoisted.status = status
  hoisted.resolutions = []
  hoisted.start.mockReset()
})
afterEach(cleanup)

describe('Launch plan page', () => {
  it('groups the plan by goal, then Polish, with progress', () => {
    mount()
    expect(screen.getByRole('heading', { level: 1, name: 'Launch plan' })).toBeVisible()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Feedback',
      'Support',
      'Polish',
    ])
    // Board and logo are done, the integration is skipped: 3 of 6.
    expect(screen.getByText('3 of 6 done')).toBeVisible()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '6')
  })

  it('says automatic steps complete themselves and offers no skip for them', () => {
    mount()
    const win = row('Get your first idea')
    expect(within(win).getByText('Marked done when it happens')).toBeVisible()
    expect(within(win).queryByRole('button')).toBeNull()
  })

  it('gives each open step one action and a Skip, and skips it', async () => {
    mount()
    const messenger = row('Connect Messenger')
    expect(within(messenger).getAllByRole('link')).toHaveLength(1)
    expect(within(messenger).getByRole('link')).toHaveAttribute(
      'href',
      '/admin/settings/widget/install'
    )
    fireEvent.click(within(messenger).getByRole('button', { name: 'Skip Connect Messenger' }))
    await waitFor(() =>
      expect(hoisted.resolutions).toEqual([
        { data: { taskId: 'connect-messenger', resolution: 'dismissed' } },
      ])
    )
  })

  it('shows a skipped step as skipped and undoes the skip', async () => {
    mount()
    const integration = row('Connect an integration')
    expect(within(integration).getByText('Skipped')).toBeVisible()
    expect(within(integration).queryByRole('link')).toBeNull()
    fireEvent.click(within(integration).getByRole('button', { name: 'Undo skip' }))
    await waitFor(() =>
      expect(hoisted.resolutions).toEqual([
        { data: { taskId: 'connect-integration', resolution: null } },
      ])
    )
  })

  it('replays the tour', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Replay the tour' }))
    expect(hoisted.start).toHaveBeenCalledTimes(1)
  })

  it('offers no skip to someone who cannot change the plan', () => {
    hoisted.status = {
      ...status,
      permissions: {
        settingsManage: false,
        boardManage: false,
        memberManage: false,
        brandingManage: false,
        integrationManage: false,
        helpCenterManage: false,
        assistantManage: false,
      },
    }
    mount()
    expect(screen.queryByRole('button', { name: /^Skip/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Undo skip' })).toBeNull()
  })

  it('asks for a workspace admin only when the viewer lacks permission', () => {
    hoisted.status = { ...status, hasBoards: false, boardCount: 1, maxBoards: 1 }
    mount()
    expect(within(row('Create a feedback board')).queryByText(/Ask a workspace admin/)).toBeNull()
    cleanup()
    hoisted.status = {
      ...status,
      hasBoards: false,
      permissions: {
        settingsManage: true,
        boardManage: false,
        memberManage: true,
        brandingManage: true,
        integrationManage: true,
        helpCenterManage: true,
        assistantManage: true,
      },
    }
    mount()
    expect(within(row('Create a feedback board')).getByText(/Ask a workspace admin/)).toBeVisible()
  })
})
