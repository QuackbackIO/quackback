// @vitest-environment happy-dom
/**
 * A board's custom fields in the widget composer: the composer asks for them,
 * names a missing required one instead of posting (the server would refuse the
 * post), and sends the answers with the post.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { WidgetHomeProps } from '../widget-home-animated'
import type { BoardCustomField } from '@/lib/shared/db-types'

const { createPost, auth } = vi.hoisted(() => ({
  createPost: vi.fn(),
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
vi.mock('@/lib/server/functions/widget/posts', () => ({
  widgetListPublicPostsFn: vi.fn(async () => ({ items: [], hasMore: false, total: 0 })),
  widgetCreatePublicPostFn: (...args: unknown[]) => createPost(...args),
}))

import { WidgetHomeAnimated } from '../widget-home-animated'

const plan: BoardCustomField = { key: 'plan', label: 'Your plan', type: 'text', required: true }
const ideas = {
  id: 'board_ideas',
  name: 'Feature Requests',
  slug: 'feature-requests-1',
  customFields: [plan],
}
const bugs = { id: 'board_bugs', name: 'Bug Reports', slug: 'bug-reports' }

function allow(boardId: string) {
  return { [boardId]: { canSubmit: true, canVote: true } }
}

let qc: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en">{children}</IntlProvider>
    </QueryClientProvider>
  )
}

function renderHome(props: Partial<WidgetHomeProps> = {}) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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

describe('widget compose board fields', () => {
  beforeEach(() => {
    auth.sessionVersion = 1
    auth.isIdentified = true
    auth.user = { name: 'Ada Example', email: 'ada@example.com' }
    createPost.mockReset()
    createPost.mockResolvedValue({
      id: 'post_1',
      title: 'Testing.',
      voteCount: 1,
      statusId: null,
      board: ideas,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ data: { posts: [] } }) }))
    )
  })

  function open(board: typeof ideas | typeof bugs) {
    renderHome({
      boards: [board],
      boardPermissions: allow(board.id),
      confirmedBoardSlugs: [board.slug],
    })
    typeTitle('Testing.')
  }

  it('names a missing required field instead of posting', async () => {
    open(ideas)
    await screen.findByRole('textbox', { name: /Your plan/ })

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    expect(await screen.findByText('Required')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: /Your plan/ })).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    // One element names the field, so the visitor (and a strict locator) finds it.
    expect(screen.getAllByText(/Your plan/)).toHaveLength(1)
    expect(screen.queryByText('Network error. Please try again.')).toBeNull()
    expect(createPost).not.toHaveBeenCalled()
  })

  it('sends the answers with the post', async () => {
    open(ideas)
    fireEvent.change(await screen.findByRole('textbox', { name: /Your plan/ }), {
      target: { value: 'Pro' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(createPost).toHaveBeenCalled())
    expect(createPost.mock.calls[0]?.[0]).toMatchObject({
      data: { boardId: ideas.id, customFields: { plan: 'Pro' } },
    })
    expect(screen.queryByText('Required')).toBeNull()
  })

  it('sends no answers for a board without fields', async () => {
    open(bugs)

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(createPost).toHaveBeenCalled())
    expect(createPost.mock.calls[0]?.[0].data).not.toHaveProperty('customFields')
  })

  it('says the board changed, and fetches its fields again, when the server refuses the answers', async () => {
    open(ideas)
    fireEvent.change(await screen.findByRole('textbox', { name: /Your plan/ }), {
      target: { value: 'Pro' },
    })
    const refused = Object.assign(new Error('Seats is required'), {
      code: 'CUSTOM_FIELDS_INVALID',
    })
    createPost.mockRejectedValueOnce(refused)
    const invalidate = vi.spyOn(qc, 'invalidateQueries')

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    expect(
      await screen.findByText("This board's questions may have changed. Check them and try again.")
    ).toBeTruthy()
    expect(screen.queryByText('Network error. Please try again.')).toBeNull()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['widget', 'boardCapabilities'] })
  })
})
