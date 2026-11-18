// @vitest-environment happy-dom
/**
 * The board picker is a lazy chunk. When it cannot load (a widget left open
 * on a host page across a deploy, the old chunk gone), the failure stays in
 * the "Posting to" row: the composer keeps what the visitor typed, the row
 * names the default board, Post still posts there, and the next time the
 * row mounts it tries the import again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { WidgetHomeProps } from '../widget-home-animated'

const { createPost, auth, picker } = vi.hoisted(() => ({
  createPost: vi.fn(),
  // How many times the picker's chunk was requested, and whether it loads.
  picker: { imports: 0, fail: true },
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
vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))
// Each load of the chunk reads this export, so a failing read stands in for a
// failed fetch (the module itself stays cached in the test runner).
vi.mock('../widget-board-select', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../widget-board-select')>()
  return {
    get WidgetBoardSelect() {
      picker.imports++
      if (picker.fail) {
        throw new TypeError(
          'Failed to fetch dynamically imported module: /assets/widget-board-select-x.js'
        )
      }
      return actual.WidgetBoardSelect
    },
  }
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

function typeTitle(value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Feedback title' }), {
    target: { value },
  })
}

describe('widget compose board when the picker cannot load', () => {
  beforeEach(() => {
    auth.sessionVersion = 1
    auth.isIdentified = true
    auth.user = { name: 'Ada Example', email: 'ada@example.com' }
    picker.imports = 0
    picker.fail = true
    createPost.mockReset()
    createPost.mockResolvedValue({
      id: 'post_1',
      title: 'Dark mode please',
      voteCount: 1,
      statusId: null,
      board: bugs,
    })
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

  it('keeps the typed idea and posts it to the default board', async () => {
    renderWithDefault()
    typeTitle('Dark mode please')
    await waitFor(() => expect(picker.imports).toBeGreaterThan(0))
    // Let the rejected import reach whatever catches it.
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(screen.getByRole('textbox', { name: 'Feedback title' })).toHaveValue('Dark mode please')
    const row = screen.getByText('Posting to').closest('div')!
    expect(within(row).getByText('Bug Reports')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()

    const post = screen.getByRole('button', { name: 'Post' })
    expect(post).toBeEnabled()
    fireEvent.click(post)
    await waitFor(() => expect(createPost).toHaveBeenCalled())
    expect(createPost.mock.calls[0]?.[0]).toMatchObject({
      data: { boardId: bugs.id, title: 'Dark mode please' },
    })
  })

  it('tries the import again the next time the row mounts', async () => {
    renderWithDefault()
    typeTitle('Dark mode please')
    await waitFor(() => expect(picker.imports).toBeGreaterThan(0))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('combobox')).toBeNull()

    // The chunk is reachable again (say, a retry after a flaky network).
    picker.fail = false
    const before = picker.imports
    typeTitle('')
    typeTitle('Dark mode please')
    expect(await screen.findByRole('combobox')).toHaveValue(bugs.id)
    expect(picker.imports).toBeGreaterThan(before)
  })
})
