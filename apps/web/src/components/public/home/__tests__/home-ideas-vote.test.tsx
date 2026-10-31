// @vitest-environment happy-dom
/**
 * Home's ideas vote as the feed's do: on a board the visitor may vote on, a
 * click votes; where they must sign in first, it asks them to.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { PortalWordsIntl } from '@/lib/client/hooks/use-intl-setup'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

const server = vi.hoisted(() => ({
  permissions: {} as Record<string, { canSubmit: boolean; canVote: boolean }>,
  vote: vi.fn(),
  openAuth: vi.fn(),
}))

const POSTS = [
  {
    id: 'post_open',
    title: 'Dark mode',
    voteCount: 4,
    statusId: null,
    board: { id: 'b_open', slug: 'open', name: 'Open' },
  },
  {
    id: 'post_closed',
    title: 'Exports',
    voteCount: 2,
    statusId: null,
    board: { id: 'b_closed', slug: 'closed', name: 'Closed' },
  },
]

vi.mock('@/lib/server/functions/portal', () => ({
  fetchPublicBoards: async () => [],
  fetchBoardCapabilitiesFn: async () => ({ permissions: server.permissions, boards: [] }),
  fetchPublicPosts: async () => ({ items: POSTS, hasMore: false }),
  fetchPublicStatuses: async () => [],
  fetchPublicTags: vi.fn(),
  fetchAvatars: vi.fn(),
  fetchPublicRoadmaps: vi.fn(),
  fetchPublicRoadmapPosts: vi.fn(),
  fetchPortalData: vi.fn(),
}))
vi.mock('@/lib/client/hooks/use-post-vote', () => ({
  usePostVote: ({ voteCount }: { voteCount: number }) => ({
    voteCount,
    hasVoted: false,
    isPending: false,
    handleVote: server.vote,
  }),
}))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopover: () => ({ openAuthPopover: server.openAuth }),
}))
vi.mock('@/lib/client/hooks/use-ensure-anon-session', () => ({
  useEnsureAnonSession: () => async () => true,
}))

import { HomeBlockView, type HomeBlock } from '../home-blocks'

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}
const IDEAS = { type: 'ideas', width: 'full', sort: 'top', count: 5 } as HomeBlock

function renderIdeas() {
  const root = createRootRoute()
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <HomeBlockView block={IDEAS} index={0} gates={GATES} />,
  })
  const router = createRouter({
    routeTree: root.addChildren([home]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" onError={() => {}}>
        <PortalWordsIntl>
          <RouterProvider router={router} />
        </PortalWordsIntl>
      </IntlProvider>
    </QueryClientProvider>
  )
}

const voteOn = (title: string) =>
  screen
    .getByText(title)
    .closest('li')!
    .querySelector('button[data-qb-part=vote-button]') as HTMLButtonElement

beforeEach(() => {
  server.permissions = {
    b_open: { canSubmit: true, canVote: true },
    b_closed: { canSubmit: false, canVote: false },
  }
  server.vote.mockReset()
  server.openAuth.mockReset()
})
afterEach(cleanup)

describe('Home’s ideas', () => {
  it('votes on a board the visitor may vote on', async () => {
    renderIdeas()
    await screen.findByText('Dark mode')
    // The board's rules arrive with the visitor's capabilities.
    await waitFor(() => expect(voteOn('Dark mode').getAttribute('aria-describedby')).toBeNull())
    await act(async () => fireEvent.click(voteOn('Dark mode')))
    await waitFor(() => expect(server.vote).toHaveBeenCalled())
    expect(server.openAuth).not.toHaveBeenCalled()
  })

  it('asks a visitor to sign in where the board needs it', async () => {
    renderIdeas()
    await screen.findByText('Exports')
    await act(async () => fireEvent.click(voteOn('Exports')))
    expect(server.openAuth).toHaveBeenCalledWith({ mode: 'login' })
    expect(server.vote).not.toHaveBeenCalled()
  })
})
