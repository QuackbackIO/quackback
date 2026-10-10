// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const hoisted = vi.hoisted(() => ({
  session: null as unknown,
  openAuthPopover: vi.fn(),
  subscribeStatusFn: vi.fn(),
  unsubscribeStatusFn: vi.fn(),
  mineQueryFn: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useSessionContext: () => hoisted.session,
}))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopoverSafe: () => ({ openAuthPopover: hoisted.openAuthPopover }),
}))
vi.mock('@/lib/server/functions/status-subscriptions', () => ({
  subscribeStatusFn: hoisted.subscribeStatusFn,
  unsubscribeStatusFn: hoisted.unsubscribeStatusFn,
}))
vi.mock('sonner', () => ({ toast: hoisted.toast }))
// A native checkbox in place of the Base UI one, whose hidden input beside its
// button lets happy-dom's <label> re-dispatch a click and toggle it twice.
vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
  }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}))
vi.mock('@/lib/client/queries/status', () => ({
  statusKeys: { mySubscription: () => ['status', 'mine'] },
  publicStatusSubscriptionQueries: {
    mine: () => ({ queryKey: ['status', 'mine'], queryFn: hoisted.mineQueryFn }),
  },
  publicStatusPageQueries: {
    get: () => ({
      queryKey: ['status', 'page'],
      queryFn: async () => ({
        snapshot: {
          ungroupedComponents: [{ id: 'status_component_api', name: 'API' }],
          groups: [{ components: [{ id: 'status_component_web', name: 'Website' }] }],
        },
      }),
    }),
  },
}))

import { StatusSubscribeButton } from '../status-subscribe-button'

const PENDING_KEY = 'quackback:pending-status-subscription'
const signedInUser = { user: { id: 'user_1', principalType: 'user' } }

beforeEach(() => {
  localStorage.clear()
  hoisted.openAuthPopover.mockReset()
  hoisted.subscribeStatusFn.mockReset().mockResolvedValue({ subscribed: true })
  hoisted.unsubscribeStatusFn.mockReset().mockResolvedValue({ subscribed: false })
  hoisted.mineQueryFn.mockReset().mockResolvedValue({ subscribed: false })
  hoisted.toast.success.mockReset()
  hoisted.toast.error.mockReset()
})
afterEach(cleanup)

function renderButton() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <IntlProvider locale="en">
        <StatusSubscribeButton />
      </IntlProvider>
    </QueryClientProvider>
  )
}

async function openDialog() {
  renderButton()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Subscribe' }))
  return user
}

function pendingSubscription() {
  const raw = localStorage.getItem(PENDING_KEY)
  return raw ? (JSON.parse(raw) as { scope: string; componentIds: string[] }) : null
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

it('keeps its name for screen readers on narrow screens, where the label is visually hidden', async () => {
  hoisted.session = null
  renderButton()
  const label = screen.getByText('Subscribe')
  // display:none would drop the name; sr-only keeps it.
  expect(label).not.toHaveClass('hidden')
  expect(label).toHaveClass('sr-only')
})

describe('signed out', () => {
  beforeEach(() => {
    hoisted.session = null
  })

  it('never asks the server for a subscription it cannot have', async () => {
    renderButton()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(hoisted.mineQueryFn).not.toHaveBeenCalled()
  })

  it('opens sign-in, returning to this page, and keeps the chosen services for after', async () => {
    window.history.replaceState(null, '', '/status')
    const user = await openDialog()
    await user.click(screen.getByRole('radio', { name: /Specific services/ }))
    await user.click(await screen.findByRole('checkbox', { name: 'Website' }))
    await user.click(screen.getByRole('button', { name: 'Subscribe' }))

    expect(hoisted.subscribeStatusFn).not.toHaveBeenCalled()
    expect(hoisted.openAuthPopover).toHaveBeenCalledWith({ mode: 'login', callbackUrl: '/status' })
    expect(pendingSubscription()).toMatchObject({
      scope: 'components',
      componentIds: ['status_component_web'],
    })
    expect(hoisted.toast.error).not.toHaveBeenCalled()
  })
})

describe('back from signing in', () => {
  it('completes the subscription the visitor chose before signing in', async () => {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ scope: 'page', componentIds: [], savedAt: Date.now() })
    )
    hoisted.session = signedInUser
    renderButton()
    await waitFor(() =>
      expect(hoisted.subscribeStatusFn).toHaveBeenCalledWith({
        data: { scope: 'page', componentIds: [] },
      })
    )
    expect(localStorage.getItem(PENDING_KEY)).toBeNull()
    await waitFor(() => expect(hoisted.toast.success).toHaveBeenCalled())
  })

  it('drops a choice left from a sign-in abandoned long ago', async () => {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ scope: 'page', componentIds: [], savedAt: Date.now() - 31 * 60 * 1000 })
    )
    hoisted.session = signedInUser
    renderButton()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(hoisted.subscribeStatusFn).not.toHaveBeenCalled()
    expect(localStorage.getItem(PENDING_KEY)).toBeNull()
  })

  it('sends a visitor whose session lapsed back through sign-in instead of failing', async () => {
    hoisted.session = signedInUser
    hoisted.subscribeStatusFn.mockRejectedValue(new Error('Authentication required'))
    const user = await openDialog()
    await user.click(screen.getByRole('button', { name: 'Subscribe' }))
    await waitFor(() => expect(hoisted.openAuthPopover).toHaveBeenCalled())
    expect(pendingSubscription()).toMatchObject({ scope: 'page' })
    expect(hoisted.toast.error).not.toHaveBeenCalled()
  })
})

describe('subscribed', () => {
  beforeEach(() => {
    hoisted.session = signedInUser
    hoisted.mineQueryFn.mockResolvedValue({ subscribed: true })
  })

  it('asks before unsubscribing', async () => {
    renderButton()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Subscribed' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Unsubscribe from status updates?')
    expect(hoisted.unsubscribeStatusFn).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Stay subscribed' }))
    expect(hoisted.unsubscribeStatusFn).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Subscribed' }))
    await user.click(await screen.findByRole('button', { name: 'Unsubscribe' }))
    await waitFor(() => expect(hoisted.unsubscribeStatusFn).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(hoisted.toast.success).toHaveBeenCalled())
  })

  it('says so when unsubscribing fails, and leaves the dialog open to retry', async () => {
    hoisted.unsubscribeStatusFn.mockRejectedValue(new Error('boom'))
    renderButton()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Subscribed' }))
    await user.click(await screen.findByRole('button', { name: 'Unsubscribe' }))
    await waitFor(() =>
      expect(hoisted.toast.error).toHaveBeenCalledWith('Could not unsubscribe. Please try again.')
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
