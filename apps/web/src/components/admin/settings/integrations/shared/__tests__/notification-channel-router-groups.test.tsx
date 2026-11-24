// @vitest-environment happy-dom
/**
 * Grouped events in the shared notification routing UI: feedback and support
 * columns read as two sets, a new channel starts with nothing picked so the
 * sets are never mixed by default, and the board filter only shows where it
 * applies (posts and comments).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const addFn = vi.fn(async (_input: unknown): Promise<unknown> => ({ success: true }))

vi.mock('@/lib/client/mutations', async () => {
  const { useMutation } = await import('@tanstack/react-query')
  return {
    useAddNotificationChannel: () => useMutation({ mutationFn: addFn }),
    useUpdateNotificationChannel: () => useMutation({ mutationFn: vi.fn() }),
    useRemoveNotificationChannel: () => useMutation({ mutationFn: vi.fn() }),
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
    group: 'Feedback',
  },
  {
    id: 'comment.created',
    label: 'New comment posted',
    shortLabel: 'Comment',
    description: 'When someone comments on a post',
    group: 'Feedback',
  },
  {
    id: 'conversation.created',
    label: 'New conversation',
    shortLabel: 'New chat',
    description: 'When a customer starts a conversation',
    group: 'Support',
  },
  {
    id: 'message.created',
    label: 'Customer message',
    shortLabel: 'Message',
    description: 'When a customer sends a message',
    group: 'Support',
  },
]

const BOARDS = [{ id: 'board_1', name: 'Ideas' }]

afterEach(() => {
  cleanup()
  addFn.mockReset().mockResolvedValue({ success: true })
})

function renderRouter(notificationChannels: NotificationChannel[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <NotificationChannelRouter<Channel>
        integrationId="integration_1"
        enabled
        events={EVENTS}
        channels={[
          { id: 'c1', name: 'support-alerts' },
          { id: 'c2', name: 'feedback' },
        ]}
        notificationChannels={notificationChannels}
        boards={BOARDS}
        loadingChannels={false}
        channelError={null}
        onRefreshChannels={vi.fn()}
        renderChannelIcon={() => null}
      />
    </QueryClientProvider>
  )
}

const routed = (channelId: string, enabled: string[]): NotificationChannel => ({
  channelId,
  events: EVENTS.map((e) => ({ eventType: e.id, enabled: enabled.includes(e.id) })),
  boardIds: null,
})

async function openAddDialog() {
  fireEvent.click(screen.getByRole('button', { name: /add your first channel/i }))
  fireEvent.click(await screen.findByRole('combobox', { name: 'Channel' }))
  fireEvent.click(await screen.findByRole('button', { name: /support-alerts/ }))
  return screen.getByRole('dialog', { name: 'Add notification channel' })
}

describe('NotificationChannelRouter with grouped events', () => {
  it('labels the routing columns by group', () => {
    renderRouter([routed('c1', ['conversation.created'])])
    const table = screen.getByRole('region', { name: 'Notification channel routing' })
    expect(within(table).getByText('Feedback')).toBeTruthy()
    expect(within(table).getByText('Support')).toBeTruthy()
  })

  it('starts a new channel with nothing picked and selects one group at a time', async () => {
    renderRouter()
    const dialog = await openAddDialog()
    const add = within(dialog).getByRole('button', { name: 'Add channel' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Select all Support' }))
    expect(add.disabled).toBe(false)
    fireEvent.click(add)

    await vi.waitFor(() => expect(addFn).toHaveBeenCalled())
    expect(addFn.mock.calls[0]?.[0]).toMatchObject({
      channelId: 'c1',
      events: ['conversation.created', 'message.created'],
    })
  })

  it('shows the board filter only once a post or comment event is picked', async () => {
    renderRouter()
    const dialog = await openAddDialog()
    // (A label-wrapped checkbox click loops in happy-dom; the group buttons
    // drive the same selection state.)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Select all Support' }))
    expect(within(dialog).queryByRole('combobox', { name: 'Board filter' })).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Select all Feedback' }))
    expect(within(dialog).getByRole('combobox', { name: 'Board filter' })).toBeTruthy()
  })

  it('hides the board filter on a support-only channel', () => {
    renderRouter([routed('c1', ['conversation.created']), routed('c2', ['post.created'])])
    fireEvent.click(screen.getByText('support-alerts'))
    expect(screen.queryByRole('combobox', { name: 'Board filter' })).toBeNull()
    fireEvent.click(screen.getByText('feedback'))
    expect(screen.getByRole('combobox', { name: 'Board filter' })).toBeTruthy()
  })
})
