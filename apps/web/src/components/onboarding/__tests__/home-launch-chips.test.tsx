// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import type { LaunchStatus } from '@/lib/shared/launch-checklist'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/client/hooks/use-permission', () => ({ usePermission: () => true }))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    onboardingStatus: () => ({ queryKey: ['admin', 'onboarding'], queryFn: async () => null }),
  },
}))

import { HomeLaunchChips, launchChips } from '../home-launch-chips'

const status: LaunchStatus = {
  hasBoards: true,
  hasPublicBoard: true,
  publicBoardId: 'board_1',
  publicBoardPath: '/?board=feedback',
  memberCount: 1,
  hasBranding: false,
  inLaunchWindow: true,
  goals: ['product_feedback', 'customer_support'],
  features: {
    supportInbox: true,
    helpCenter: false,
    statusPage: false,
    integrations: false,
    assistant: false,
    changelog: true,
  },
}

const names = (input: LaunchStatus) =>
  launchChips(input).map((chip) => (chip.kind === 'task' ? chip.task.id : chip.kind))

afterEach(cleanup)

describe("Home's chips", () => {
  it('come from the open steps beside the path, with trying Messenger next to installing it', () => {
    expect(names(status)).toEqual(['connect-messenger', 'try-messenger', 'publish-changelog'])
  })

  it('drop a step once it is done', () => {
    expect(names({ ...status, hasWidgetInstalled: true, hasWidgetEnabled: true })).toEqual([
      'publish-changelog',
      'invite-team',
      'customize-branding',
    ])
  })

  it('are gone once the plan is done', () => {
    expect(names({ ...status, hasFirstWin: true })).toEqual([])
  })

  it('open the existing sheets directly, never a Copilot turn', () => {
    const client = new QueryClient()
    client.setQueryData(['admin', 'onboarding'], status)
    const opened: unknown[] = []
    const tried: unknown[] = []
    window.addEventListener('quackback:open-going-live', (event) =>
      opened.push((event as CustomEvent).detail)
    )
    window.addEventListener('quackback:open-try-messenger', (event) =>
      tried.push((event as CustomEvent).detail)
    )
    render(
      <IntlProvider locale="en" messages={en}>
        <QueryClientProvider client={client}>
          <HomeLaunchChips />
        </QueryClientProvider>
      </IntlProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Put Messenger on your site' }))
    expect(opened).toEqual(['install-messenger'])
    fireEvent.click(screen.getByRole('button', { name: 'Try Messenger as a customer' }))
    expect(tried).toEqual(['message'])
    expect(screen.getByRole('link', { name: 'Publish your first update' })).toHaveAttribute(
      'href',
      '/admin/changelog'
    )
  })
})
