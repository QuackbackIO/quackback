// @vitest-environment happy-dom
/**
 * Home's Share an idea is the feed's composer in the brand's shape: it opens
 * in place, posts to the first board the visitor can post on, and takes them
 * to the idea they posted. The router is real; the server is not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, forwardRef, type ReactNode } from 'react'
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
  boards: [] as Array<{ id: string; name: string; slug: string; settings: object }>,
  permissions: {} as Record<string, { canSubmit: boolean; canVote: boolean }>,
  createPost: vi.fn(),
}))

vi.mock('@/lib/server/functions/portal', () => ({
  fetchPublicBoards: async () => server.boards,
  fetchBoardCapabilitiesFn: async () => ({ permissions: server.permissions, boards: [] }),
  fetchPublicPosts: vi.fn(),
  fetchPublicStatuses: vi.fn(),
  fetchPublicTags: vi.fn(),
  fetchAvatars: vi.fn(),
  fetchPublicRoadmaps: vi.fn(),
  fetchPublicRoadmapPosts: vi.fn(),
  fetchPortalData: vi.fn(),
}))
vi.mock('@/lib/client/mutations/portal-posts', () => ({
  useCreatePublicPost: () => ({ mutateAsync: server.createPost, isPending: false }),
}))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopover: () => ({ openAuthPopover: vi.fn() }),
}))
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({ useAuthBroadcast: () => {} }))
vi.mock('@/lib/client/hooks/use-similar-posts', () => ({ useSimilarPosts: () => ({ posts: [] }) }))
vi.mock('@/lib/client/hooks/use-ensure-anon-session', () => ({
  useEnsureAnonSession: () => async () => true,
}))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  usePortalMediaUpload: () => ({ upload: vi.fn() }),
}))
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => <div data-testid="editor" />,
}))
vi.mock('framer-motion', () => {
  const MOTION_PROPS = new Set(['initial', 'animate', 'exit', 'transition', 'variants', 'layout'])
  const make = (tag: string) =>
    forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
      const { children, ...rest } = props
      const dom: Record<string, unknown> = { ref }
      for (const [key, value] of Object.entries(rest)) if (!MOTION_PROPS.has(key)) dom[key] = value
      return createElement(tag, dom, children as ReactNode)
    })
  // One component per tag, so a re-render keeps the same element.
  const made = new Map<string, ReturnType<typeof make>>()
  const proxy = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (typeof prop !== 'string') return undefined
        if (!made.has(prop)) made.set(prop, make(prop))
        return made.get(prop)
      },
    }
  )
  return { AnimatePresence: ({ children }: { children?: ReactNode }) => children, motion: proxy }
})

import { HomeBlockView, type HomeBlock } from '../home-blocks'

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

const COMPOSER = { type: 'composer', width: 'full' } as HomeBlock

function renderHome(gates = GATES) {
  const root = createRootRoute()
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <HomeBlockView block={COMPOSER} index={0} gates={gates} />,
  })
  const post = createRoute({
    getParentRoute: () => root,
    path: '/b/$slug/posts/$postId',
    component: () => <p>the idea</p>,
  })
  const router = createRouter({
    routeTree: root.addChildren([home, post]),
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
  return router
}

beforeEach(() => {
  server.boards = [
    { id: 'board_team', name: 'Team only', slug: 'team', settings: {} },
    { id: 'board_ideas', name: 'Ideas', slug: 'ideas', settings: {} },
  ]
  server.permissions = {
    board_team: { canSubmit: false, canVote: false },
    board_ideas: { canSubmit: true, canVote: true },
  }
  server.createPost.mockReset()
  server.createPost.mockResolvedValue({ id: 'post_1', board: { slug: 'ideas' } })
})
afterEach(cleanup)

describe('Home’s Share an idea', () => {
  it('opens in place, as the full composer, without leaving Home', async () => {
    const router = renderHome()
    await screen.findByRole('textbox', { name: 'Idea title' })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(screen.getByText('Posting to')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/')
  })

  it('posts to the first board the visitor can post on, and goes to the idea', async () => {
    const router = renderHome()
    const input = await screen.findByRole('textbox', { name: 'Idea title' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '  Dark mode for the app  ' } })
    // Submit opens once the visitor's boards are known.
    const submit = () => screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement
    await waitFor(() => expect(submit().disabled).toBe(false))
    await act(async () => fireEvent.click(submit()))
    await waitFor(() =>
      expect(server.createPost).toHaveBeenCalledWith(
        expect.objectContaining({ boardId: 'board_ideas', title: 'Dark mode for the app' })
      )
    )
    await screen.findByText('the idea')
    expect(router.state.location.pathname).toBe('/b/ideas/posts/post_1')
  })

  it('is not drawn while Feedback is off', async () => {
    renderHome({ ...GATES, feedback: false })
    await act(async () => {})
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
