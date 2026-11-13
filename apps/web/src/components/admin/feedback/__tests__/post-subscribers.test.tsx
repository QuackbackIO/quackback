// @vitest-environment happy-dom
/**
 * The post modal's subscribers row (post-subscribers.tsx): who follows the
 * post, why and how, someone who lost sight of it marked as not notified,
 * subscribing a person from the search, and the read-only view for a teammate
 * who can't manage subscribers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PostId } from '@quackback/ids'

vi.mock('@/lib/server/functions/post-subscribers', () => ({
  listPostSubscribersFn: vi.fn(),
  addPostSubscriberFn: vi.fn(),
  removePostSubscriberFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/admin')>()),
  searchPeopleFn: vi.fn(),
}))

import {
  addPostSubscriberFn,
  listPostSubscribersFn,
  removePostSubscriberFn,
} from '@/lib/server/functions/post-subscribers'
import { searchPeopleFn } from '@/lib/server/functions/admin'
import { PostSubscribers } from '../post-subscribers'

const POST = 'post_1' as PostId

const subscriber = (over: Record<string, unknown>) => ({
  principalId: 'principal_x',
  displayName: 'Someone',
  email: null,
  avatarUrl: null,
  isTeamMember: false,
  reason: 'vote',
  level: 'all',
  canView: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderRow(props: { canManage: boolean; canSearchPeople: boolean }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en-US" messages={{}}>
        <PostSubscribers postId={POST} {...props} />
      </IntlProvider>
    </QueryClientProvider>
  )
}

describe('PostSubscribers', () => {
  it('lists who follows the post, why, how, and who is no longer notified', async () => {
    vi.mocked(listPostSubscribersFn).mockResolvedValue([
      subscriber({ principalId: 'principal_ada', displayName: 'Ada', level: 'status_only' }),
      subscriber({ principalId: 'principal_bo', displayName: 'Bo', canView: false }),
    ] as never)
    renderRow({ canManage: false, canSearchPeople: false })

    fireEvent.click(await screen.findByRole('button', { name: 'Subscribers' }))
    expect(await screen.findByText('Voted · Status changes only')).toBeTruthy()
    expect(screen.getByText('Cannot see this post, not notified')).toBeTruthy()
    // Read-only: no add, no remove.
    expect(screen.queryByText('Add subscriber')).toBeNull()
    expect(screen.queryByRole('button', { name: /Unsubscribe/ })).toBeNull()
  })

  it('subscribes someone picked from the search, skipping people already subscribed', async () => {
    vi.mocked(listPostSubscribersFn).mockResolvedValue([
      subscriber({ principalId: 'principal_ada', displayName: 'Ada' }),
    ] as never)
    vi.mocked(searchPeopleFn).mockResolvedValue([
      { id: 'principal_ada', name: 'Ada', email: 'ada@example.com', image: null },
      { id: 'principal_cy', name: 'Cy', email: 'cy@example.com', image: null },
    ] as never)
    vi.mocked(addPostSubscriberFn).mockResolvedValue({ added: true } as never)
    renderRow({ canManage: true, canSearchPeople: true })

    fireEvent.click(await screen.findByText('Add subscriber'))
    fireEvent.click(await screen.findByText('Cy'))
    await waitFor(() =>
      expect(addPostSubscriberFn).toHaveBeenCalledWith({
        data: { postId: POST, principalId: 'principal_cy' },
      })
    )
    expect(screen.queryByText('ada@example.com')).toBeNull()
  })

  it('unsubscribes someone from the list', async () => {
    vi.mocked(listPostSubscribersFn).mockResolvedValue([
      subscriber({ principalId: 'principal_ada', displayName: 'Ada' }),
    ] as never)
    vi.mocked(removePostSubscriberFn).mockResolvedValue({ removed: true } as never)
    renderRow({ canManage: true, canSearchPeople: false })

    expect(screen.queryByText('Add subscriber')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Subscribers' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Unsubscribe Ada' }))
    await waitFor(() =>
      expect(removePostSubscriberFn).toHaveBeenCalledWith({
        data: { postId: POST, principalId: 'principal_ada' },
      })
    )
  })
})
