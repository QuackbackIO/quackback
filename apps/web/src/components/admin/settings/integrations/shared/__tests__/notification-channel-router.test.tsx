// @vitest-environment happy-dom
/**
 * Failure paths of the shared notification routing UI: a channel the integration
 * cannot post to is not selectable, and a rejected add or update is shown instead
 * of silently leaving the dialog or checkbox where it was.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Server functions reach the client as a plain Error carrying only the message.
const addFn = vi.fn(async (_input: unknown): Promise<unknown> => ({ success: true }))
const updateFn = vi.fn(async (_input: unknown): Promise<unknown> => ({ success: true }))
const removeFn = vi.fn(async (_input: unknown): Promise<unknown> => ({ success: true }))

vi.mock('@/lib/client/mutations', async () => {
  const { useMutation } = await import('@tanstack/react-query')
  return {
    useAddNotificationChannel: () => useMutation({ mutationFn: addFn }),
    useUpdateNotificationChannel: () => useMutation({ mutationFn: updateFn }),
    useRemoveNotificationChannel: () => useMutation({ mutationFn: removeFn }),
  }
})

import {
  NotificationChannelRouter,
  type Channel,
  type EventConfig,
  type NotificationChannel,
} from '../notification-channel-router'

const EVENTS: EventConfig[] = [
  {
    id: 'post.created',
    label: 'New post submitted',
    shortLabel: 'New post',
    description: 'When someone submits a new post',
  },
]

const NO_ACCESS = 'Give the bot access to this channel in Discord, then try again.'

afterEach(() => {
  cleanup()
  addFn.mockReset().mockResolvedValue({ success: true })
  updateFn.mockReset().mockResolvedValue({ success: true })
  removeFn.mockReset().mockResolvedValue({ success: true })
})

function renderRouter(channels: Channel[], notificationChannels: NotificationChannel[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <NotificationChannelRouter<Channel>
        integrationId="integration_1"
        enabled
        events={EVENTS}
        channels={channels}
        notificationChannels={notificationChannels}
        boards={[]}
        loadingChannels={false}
        channelError={null}
        onRefreshChannels={vi.fn()}
        renderChannelIcon={() => null}
      />
    </QueryClientProvider>
  )
}

async function pickChannel(name: string) {
  fireEvent.click(screen.getByRole('button', { name: /add your first channel/i }))
  fireEvent.click(await screen.findByRole('combobox', { name: 'Channel' }))
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }))
}

describe('NotificationChannelRouter', () => {
  it('shows why adding a channel failed and keeps the dialog open', async () => {
    addFn.mockRejectedValue(new Error(NO_ACCESS))
    renderRouter([{ id: 'c1', name: 'general' }])

    await pickChannel('general')
    fireEvent.click(screen.getByRole('button', { name: 'Add channel' }))

    expect(await screen.findByText(NO_ACCESS)).toBeTruthy()
    expect(addFn.mock.calls[0]?.[0]).toMatchObject({ channelId: 'c1' })
    expect(screen.getByText('Add notification channel')).toBeTruthy()
  })

  it('clears the error when the dialog is closed and reopened', async () => {
    addFn.mockRejectedValue(new Error(NO_ACCESS))
    renderRouter([{ id: 'c1', name: 'general' }])

    await pickChannel('general')
    fireEvent.click(screen.getByRole('button', { name: 'Add channel' }))
    await screen.findByText(NO_ACCESS)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('Add notification channel')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: /add your first channel/i }))
    await screen.findByText('Add notification channel')
    expect(screen.queryByText(NO_ACCESS)).toBeNull()
  })

  it('does not let an admin pick a channel the integration cannot post to', async () => {
    renderRouter([
      { id: 'c1', name: 'private-team', canPost: false },
      { id: 'c2', name: 'general' },
    ])

    fireEvent.click(screen.getByRole('button', { name: /add your first channel/i }))
    fireEvent.click(await screen.findByRole('combobox', { name: 'Channel' }))
    const blocked = await screen.findByRole('button', { name: /private-team/ })
    expect(blocked.hasAttribute('disabled')).toBe(true)
    expect(blocked.textContent).toContain('No access')
    expect((screen.getByRole('button', { name: /general/ }) as HTMLButtonElement).disabled).toBe(
      false
    )

    fireEvent.click(blocked)
    expect(screen.getByRole('combobox', { name: 'Channel' }).textContent).toContain(
      'Select a channel'
    )
    expect(
      (screen.getByRole('button', { name: 'Add channel' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('shows why updating a routed channel failed', async () => {
    updateFn.mockRejectedValue(new Error(NO_ACCESS))
    renderRouter(
      [{ id: 'c1', name: 'general' }],
      [{ channelId: 'c1', events: [{ eventType: 'post.created', enabled: true }], boardIds: null }]
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'New post submitted for #general' }))

    expect(await screen.findByText(NO_ACCESS)).toBeTruthy()
    expect(updateFn.mock.calls[0]?.[0]).toMatchObject({ channelId: 'c1' })
  })

  it('clears a failed removal when the confirmation is closed and reopened', async () => {
    const failure = "Couldn't reach the server"
    removeFn.mockRejectedValue(new Error(failure))
    renderRouter(
      [{ id: 'c1', name: 'general' }],
      [{ channelId: 'c1', events: [{ eventType: 'post.created', enabled: true }], boardIds: null }]
    )

    fireEvent.click(screen.getByText('general'))
    fireEvent.click(await screen.findByRole('button', { name: /remove channel/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(await screen.findByText(failure)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('Remove notification channel')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /remove channel/i }))
    await screen.findByText('Remove notification channel')
    expect(screen.queryByText(failure)).toBeNull()
  })
})
