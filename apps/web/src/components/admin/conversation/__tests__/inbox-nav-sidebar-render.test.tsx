// @vitest-environment happy-dom
/**
 * The inbox route re-renders whenever its URL changes, which includes opening
 * a conversation. The nav sidebar's props do not change then, so it skips
 * that render instead of redrawing every scope, badge and saved view; and a
 * navigation that hands the route context a new identity, with the same
 * feature flags, leaves it alone too.
 */
import { useState, useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InboxNavItem } from '@/lib/client/conversation/inbox-scope'

afterEach(cleanup)

const pageHeaderRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/components/shared/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => {
    pageHeaderRenders.count++
    return <h1>{title}</h1>
  },
}))

// The root route context as a store, like the router's own: every navigation
// hands out a new context object, and a reader re-renders when what it
// selected changes.
const rootContext = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const store = {
    value: { session: {}, settings: { featureFlags: { supportTickets: true } } } as Record<
      string,
      unknown
    >,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    navigate() {
      store.value = { ...store.value, session: {} }
      for (const listener of listeners) listener()
    },
  }
  return store
})
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: (opts: { select?: (context: Record<string, unknown>) => unknown }) => {
    const read = () => (opts.select ? opts.select(rootContext.value) : rootContext.value)
    return useSyncExternalStore(rootContext.subscribe, read, read)
  },
}))

const pending = () => new Promise<never>(() => {})
vi.mock('@/lib/server/functions/conversation-tags', () => ({
  fetchConversationTagsWithCountsFn: pending,
}))
vi.mock('@/lib/server/functions/conversation-segments', () => ({
  fetchInboxSegmentsWithCountsFn: pending,
}))
vi.mock('@/lib/server/functions/conversation-views', () => ({
  listConversationViewsFn: pending,
  pinConversationViewFn: vi.fn(),
  unpinConversationViewFn: vi.fn(),
  deleteConversationViewFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/inbox', () => ({
  fetchInboxCountsFn: pending,
  listInboxItemsFn: pending,
  getConversationTicketLinkFn: pending,
}))
vi.mock('@/lib/server/functions/teams', () => ({ listTeamsFn: pending }))

const { InboxNavSidebar } = await import('../inbox-nav-sidebar')

const NAV: InboxNavItem = { kind: 'view', view: 'all' }
const onSelect = vi.fn()
const onSearch = vi.fn()

function renderSidebar() {
  let rerenderParent = () => {}
  function Parent() {
    const [, setTick] = useState(0)
    rerenderParent = () => setTick((n) => n + 1)
    return <InboxNavSidebar nav={NAV} onSelect={onSelect} search="" onSearch={onSearch} />
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Parent />
    </QueryClientProvider>
  )
  return { rerenderParent: () => rerenderParent() }
}

describe('InboxNavSidebar', () => {
  it('skips a re-render of its parent that leaves its props as they were', () => {
    const { rerenderParent } = renderSidebar()
    const rendersAfterMount = pageHeaderRenders.count

    act(() => rerenderParent())
    act(() => rerenderParent())

    expect(pageHeaderRenders.count).toBe(rendersAfterMount)
  })

  it('skips a navigation that leaves the feature flags as they were', () => {
    renderSidebar()
    const rendersAfterMount = pageHeaderRenders.count

    act(() => rootContext.navigate())

    expect(pageHeaderRenders.count).toBe(rendersAfterMount)
  })
})
