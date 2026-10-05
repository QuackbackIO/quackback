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
vi.mock('@/lib/server/functions/activation', () => ({
  markPublicBoardLinkCopiedFn: vi.fn(),
  markStatusLinkCopiedFn: vi.fn(),
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useBaseUrl: () => 'https://acme.example.com',
}))
vi.mock('@/lib/client/plg-events', () => ({ recordPlgEvent: vi.fn() }))
vi.mock('@/components/admin/settings/boards/create-board-dialog', () => ({
  CreateBoardDialog: () => null,
}))
vi.mock('../product-tour', () => ({ useProductTour: () => ({ start: hoisted.start }) }))

import { LaunchPlanPage } from '../launch-plan-page'

const AT = '2026-10-03T10:00:00.000Z'

const status: LaunchStatus = {
  hasBoards: true,
  hasPublicBoard: true,
  publicBoardId: 'board_1',
  publicBoardPath: '/?board=feedback',
  publicBoardSlug: 'feedback',
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
  it('leads with the three-step path and its one count, then everything else under Later', () => {
    mount()
    expect(screen.getByRole('heading', { level: 1, name: 'Launch plan' })).toBeVisible()
    expect(screen.getByText('Step 2 of 3')).toBeVisible()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '3')
    const live = row('Your board is live')
    expect(within(live).getByText('Done')).toBeTruthy()
    expect(within(live).getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      'https://acme.example.com/?board=feedback'
    )
    expect(within(live).getByRole('link', { name: 'Who can see it' })).toHaveAttribute(
      'href',
      '/admin/settings/boards/feedback?tab=access'
    )
    expect(
      within(row('Share your board link')).getByRole('button', { name: 'Copy board link' })
    ).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: 'Later' })).toBeVisible()
    expect(within(row('Add your logo')).getByText('Done')).toBeVisible()
  })

  it('leaves out a step setup did itself', () => {
    mount()
    expect(screen.queryByText('Create a feedback board')).toBeNull()
  })

  it('gives every step a short outcome line and never strikes a step through', () => {
    mount()
    expect(
      within(row('Put Messenger on your site')).getByText('Customers reach you from your site')
    ).toBeVisible()
    expect(document.querySelector('.line-through')).toBeNull()
  })

  it('says the first win completes itself and offers no skip on the path', () => {
    mount()
    const win = row('A customer posts an idea')
    expect(within(win).getByText('Marked done when it happens')).toBeVisible()
    expect(within(win).queryByRole('button')).toBeNull()
    expect(within(row('Share your board link')).queryByRole('button', { name: /^Skip/ })).toBeNull()
  })

  it('gives each open later step one action and a Skip, and skips it', async () => {
    mount()
    const messenger = row('Put Messenger on your site')
    // Messenger opens its install sheet in place.
    expect(within(messenger).queryByRole('link')).toBeNull()
    const opened = vi.fn()
    window.addEventListener('quackback:open-going-live', (event) =>
      opened((event as CustomEvent).detail)
    )
    fireEvent.click(within(messenger).getByRole('button', { name: 'Start' }))
    expect(opened).toHaveBeenCalledWith('install-messenger')
    fireEvent.click(
      within(messenger).getByRole('button', { name: 'Skip Put Messenger on your site' })
    )
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

  it('lets a path step skipped before it joined the path be restored', async () => {
    hoisted.status = {
      ...status,
      taskResolutions: {
        product_feedback: { 'distribute-feedback': { resolution: 'dismissed', resolvedAt: AT } },
      },
    }
    mount()
    const share = row('Share your board link')
    expect(within(share).getByText('Skipped')).toBeVisible()
    expect(within(share).queryByRole('button', { name: /^Skip/ })).toBeNull()
    fireEvent.click(within(share).getByRole('button', { name: 'Undo skip' }))
    await waitFor(() =>
      expect(hoisted.resolutions).toEqual([
        { data: { taskId: 'distribute-feedback', resolution: null } },
      ])
    )
  })

  it('stays open with every chore done until a customer acts', () => {
    hoisted.status = {
      ...status,
      publicBoardLinkCopiedAt: AT,
      hasWidgetInstalled: true,
      hasWidgetEnabled: true,
      memberCount: 2,
    }
    mount()
    expect(screen.getByText('Step 3 of 3')).toBeVisible()
    expect(within(row('A customer posts an idea')).getByText('Next')).toBeVisible()
  })

  it('falls back to the feedback path when the primary module is turned off', () => {
    const modules = ['supportInbox', 'helpCenter', 'statusPage'] as const
    const goals = {
      supportInbox: 'customer_support',
      helpCenter: 'help_center',
      statusPage: 'status_page',
    } as const
    for (const module of modules) {
      hoisted.status = {
        ...status,
        goals: [goals[module]],
        features: { ...status.features!, [module]: false },
      }
      mount()
      expect(screen.getByText('Step 2 of 3')).toBeVisible()
      expect(
        within(row('Share your board link')).getByRole('button', { name: 'Copy board link' })
      ).toBeVisible()
      cleanup()
    }
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
    hoisted.status = {
      ...status,
      hasPublicBoard: false,
      hasBoards: false,
      boardCount: 1,
      maxBoards: 1,
    }
    mount()
    expect(within(row('Create a feedback board')).queryByText(/Ask a workspace admin/)).toBeNull()
    cleanup()
    hoisted.status = {
      ...status,
      hasPublicBoard: false,
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
