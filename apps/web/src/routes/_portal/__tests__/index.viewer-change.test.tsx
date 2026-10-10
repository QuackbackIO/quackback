// @vitest-environment happy-dom
/**
 * The portal feed is keyed by viewer, so a visitor's first action (an
 * anonymous post or vote) that mints a session also changes the feed's
 * query key. The feed already on screen, and the composer inside it, must
 * stay mounted and visible while the new viewer's feed loads: swapping it
 * for the loading skeleton mid-submit hides the composer and leaves it
 * stuck on "Submitting...".
 *
 * The router context is an external store read with useSyncExternalStore,
 * as the router's own store is, so a session change re-renders the feed
 * synchronously, as it does after `router.invalidate()`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState, useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

type Session = { user: { id: string; principalType: string } } | null

const { rootContext, feed } = vi.hoisted(() => {
  let context: { session: Session; settings: { name: string; slug: string } } = {
    session: null,
    settings: { name: 'Acme', slug: 'acme' },
  }
  const listeners = new Set<() => void>()
  return {
    rootContext: {
      get: () => context,
      setSession(session: Session) {
        context = { ...context, session }
        for (const listener of listeners) listener()
      },
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      reset() {
        context = { session: null, settings: { name: 'Acme', slug: 'acme' } }
        listeners.clear()
      },
    },
    // The feed fetch per viewer id, resolved by the test.
    feed: {
      pending: new Map<string | undefined, (value: unknown) => void>(),
    },
  }
})

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    <T extends object>(options: T) => ({
      ...options,
      useLoaderData: () => ({ workspaceName: 'Acme', baseUrl: '', showPoweredBy: false }),
      useSearch: () => ({ sort: 'trending' }),
    }),
  notFound: () => new Error('not found'),
  redirect: () => new Error('redirect'),
  useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
    const context = useSyncExternalStore(rootContext.subscribe, rootContext.get)
    return opts?.select ? opts.select(context as never) : context
  },
}))
vi.mock('@/lib/server/functions/powered-by', () => ({ getShowPoweredByFn: vi.fn() }))
vi.mock('@/components/public/preview-draft-context', () => ({
  usePreviewWelcomeCard: () => null,
}))
vi.mock('@/components/public/feedback/portal-welcome-card', () => ({
  PortalWelcomeCard: () => null,
}))
vi.mock('@/lib/client/queries/portal', () => ({
  portalQueries: {
    portalData: (params: { userId?: string }) => ({
      queryKey: ['portal', 'data', params.userId],
      queryFn: () => new Promise((resolve) => feed.pending.set(params.userId, resolve)),
    }),
  },
  useSeedPortalStatusesCache: () => {},
}))
// The feed itself: a draft typed into it shows whether it stayed mounted.
vi.mock('@/components/public/feedback/feedback-container', () => ({
  FeedbackContainer: ({ posts }: { posts: { id: string }[] }) => {
    const [draft, setDraft] = useState('')
    return (
      <div data-testid="feed" data-posts={posts.length}>
        <input
          aria-label="Feedback title"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
    )
  },
}))

import { Route } from '../index'

const Page = (Route as unknown as { component: React.ComponentType }).component

function portalData(postIds: string[]) {
  return {
    boards: [{ id: 'board_1', name: 'Ideas', slug: 'ideas' }],
    posts: { items: postIds.map((id) => ({ id })), hasMore: false },
    statuses: [],
    tags: [],
    votedPostIds: [],
    boardPermissions: { board_1: { canSubmit: true, canVote: true } },
  }
}

function renderPortal() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // The anonymous feed the page was served with.
  queryClient.setQueryData(['portal', 'data', undefined], portalData([]))
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <Page />
      </IntlProvider>
    </QueryClientProvider>
  )
  return queryClient
}

function isShown(element: HTMLElement) {
  return element.closest('[style*="display: none"]') === null
}

afterEach(() => {
  cleanup()
  rootContext.reset()
  feed.pending.clear()
})

describe('portal feed when the viewer changes', () => {
  it('keeps the feed and the draft in it on screen while the new viewer feed loads', async () => {
    renderPortal()
    const title = screen.getByRole<HTMLInputElement>('textbox', { name: 'Feedback title' })
    fireEvent.change(title, { target: { value: 'Dark mode' } })

    // The visitor's first post mints an anonymous session.
    act(() => rootContext.setSession({ user: { id: 'user_anon', principalType: 'anonymous' } }))

    expect(document.querySelector('.animate-pulse')).toBeNull()
    expect(isShown(screen.getByTestId('feed'))).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Feedback title' }).value).toBe(
      'Dark mode'
    )

    // The new viewer's feed arrives, with their post in it.
    await waitFor(() => expect(feed.pending.has('user_anon')).toBe(true))
    await act(async () => feed.pending.get('user_anon')!(portalData(['post_1'])))

    await waitFor(() => expect(screen.getByTestId('feed').dataset.posts).toBe('1'))
    expect(isShown(screen.getByTestId('feed'))).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Feedback title' }).value).toBe(
      'Dark mode'
    )
  })

  // Signing in or out clears every viewer's feed before the session changes.
  // There is no previous feed left to keep on screen, so the page fetches the
  // new viewer's feed only, never the old viewer's again under the new cookie.
  it('fetches only the new viewer feed when a sign-in cleared the old one', async () => {
    const queryClient = renderPortal()

    act(() => {
      queryClient.removeQueries({ queryKey: ['portal', 'data'] })
      rootContext.setSession({ user: { id: 'user_b', principalType: 'user' } })
    })

    await waitFor(() => expect(feed.pending.has('user_b')).toBe(true))
    expect(feed.pending.has(undefined)).toBe(false)
  })
})
