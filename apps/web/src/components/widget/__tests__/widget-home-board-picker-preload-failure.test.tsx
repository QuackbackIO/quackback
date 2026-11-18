// @vitest-environment happy-dom
/**
 * Focusing the compose title warms the board picker's chunk. When that fetch
 * fails, the warm-up swallows it: no unhandled rejection reaches the host
 * page's console, and the widget keeps rendering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { WidgetHomeProps } from '../widget-home-animated'

const { createPost, auth, picker } = vi.hoisted(() => ({
  createPost: vi.fn(),
  // How many times the picker's chunk was requested.
  picker: { imports: 0 },
  auth: {
    sessionVersion: 0,
    isIdentified: false,
    user: null as { name: string; email: string } | null,
  },
}))

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    ensureSession: async () => true,
    ensureSessionThen: async (cb: () => void | Promise<void>) => cb(),
    isIdentified: auth.isIdentified,
    hmacRequired: true,
    user: auth.user,
    emitEvent: vi.fn(),
    metadata: null,
    getSessionVersion: () => auth.sessionVersion,
    sessionVersion: auth.sessionVersion,
  }),
}))
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({ Authorization: 'Bearer test' }),
}))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('../use-widget-image-upload', () => ({
  useWidgetMediaUpload: () => ({ upload: vi.fn() }),
  WidgetSessionError: class WidgetSessionError extends Error {},
}))
vi.mock('../widget-vote-button', () => ({ WidgetVoteButton: () => null }))
vi.mock('framer-motion', async () => {
  const { createElement, forwardRef } = await import('react')
  const MOTION_PROPS = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'layout',
    'whileHover',
    'whileTap',
    'whileFocus',
    'whileInView',
  ])
  const make = (tag: string) =>
    forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
      const { children, ...rest } = props
      const dom: Record<string, unknown> = { ref }
      for (const [key, value] of Object.entries(rest)) {
        if (!MOTION_PROPS.has(key)) dom[key] = value
      }
      return createElement(tag, dom, children as ReactNode)
    })
  const proxy = new Proxy(
    {},
    { get: (_target, prop) => (typeof prop === 'string' ? make(prop) : undefined) }
  )
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    // m mirrors motion here: the fake components don't care which name reaches
    // them, only the source's switch to LazyMotion's m does.
    motion: proxy,
    m: proxy,
    useReducedMotion: () => true,
  }
})
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => <div data-testid="editor" />,
}))
vi.mock('../widget-board-select', () => {
  picker.imports++
  throw new TypeError(
    'Failed to fetch dynamically imported module: /assets/widget-board-select-x.js'
  )
})
vi.mock('@/lib/server/functions/widget/posts', () => ({
  widgetListPublicPostsFn: vi.fn(async () => ({ items: [], hasMore: false, total: 0 })),
  widgetCreatePublicPostFn: (...args: unknown[]) => createPost(...args),
}))

import { WidgetHomeAnimated } from '../widget-home-animated'

const ideas = { id: 'board_ideas', name: 'Feature Requests', slug: 'feature-requests-1' }
const bugs = { id: 'board_bugs', name: 'Bug Reports', slug: 'bug-reports' }

function allow(boardId: string) {
  return { [boardId]: { canSubmit: true, canVote: true } }
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en">{children}</IntlProvider>
    </QueryClientProvider>
  )
}

function renderHome(props: Partial<WidgetHomeProps> = {}) {
  return render(
    <WidgetHomeAnimated
      initialPosts={[]}
      statuses={[]}
      boards={props.boards ?? []}
      boardPermissions={props.boardPermissions}
      defaultBoard={props.defaultBoard}
      confirmedBoardSlugs={props.confirmedBoardSlugs}
      composeRequest={props.composeRequest}
    />,
    { wrapper }
  )
}

describe('widget compose board picker warm-up', () => {
  beforeEach(() => {
    auth.sessionVersion = 1
    auth.isIdentified = true
    auth.user = { name: 'Ada Example', email: 'ada@example.com' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ data: { posts: [] } }) }))
    )
  })

  function renderWithDefault() {
    return renderHome({
      boards: [ideas, bugs],
      boardPermissions: { ...allow(ideas.id), ...allow(bugs.id) },
      defaultBoard: 'bug-reports',
      confirmedBoardSlugs: ['feature-requests-1', 'bug-reports'],
    })
  }

  it('a failed preload when the title gets focus raises no unhandled rejection', async () => {
    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', onRejection)
    try {
      renderWithDefault()
      fireEvent.focus(screen.getByRole('textbox', { name: 'Feedback title' }))
      await waitFor(() => expect(picker.imports).toBeGreaterThan(0))
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(rejections).toEqual([])
      expect(screen.getByRole('textbox', { name: 'Feedback title' })).toBeTruthy()
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })
})
