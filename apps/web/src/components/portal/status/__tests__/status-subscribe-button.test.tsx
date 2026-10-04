// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const hoisted = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useSessionContext: () => hoisted.session,
}))
vi.mock('@/components/auth/auth-popover-context', () => ({ useAuthPopoverSafe: () => null }))
vi.mock('@/lib/server/functions/status-subscriptions', () => ({
  subscribeStatusFn: vi.fn(),
  unsubscribeStatusFn: vi.fn(),
}))
vi.mock('@/lib/client/queries/status', () => ({
  statusKeys: { mySubscription: () => ['status', 'mine'] },
  publicStatusSubscriptionQueries: {
    mine: () => ({ queryKey: ['status', 'mine'], queryFn: async () => ({ subscribed: false }) }),
  },
  publicStatusPageQueries: {
    get: () => ({ queryKey: ['status', 'page'], queryFn: async () => null }),
  },
}))

import { StatusSubscribeButton } from '../status-subscribe-button'

afterEach(cleanup)

async function openDialog() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en">
        <StatusSubscribeButton />
      </IntlProvider>
    </QueryClientProvider>
  )
  await userEvent.setup().click(screen.getByRole('button', { name: 'Subscribe' }))
}

it('tells a signed-out visitor that email needs an account and offers the RSS feed', async () => {
  hoisted.session = null
  await openDialog()
  expect(screen.getByText(/Email updates need a free portal account/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'RSS feed' })).toHaveAttribute('href', '/status/feed')
})

it('says nothing about accounts to a signed-in visitor', async () => {
  hoisted.session = { user: { id: 'user_1', principalType: 'user' } }
  await openDialog()
  expect(screen.queryByText(/Email updates need a free portal account/)).toBeNull()
})
