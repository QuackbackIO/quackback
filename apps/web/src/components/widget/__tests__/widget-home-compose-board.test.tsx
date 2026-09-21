// @vitest-environment happy-dom
/**
 * Compose board row: one visible board is shown and selected, including when
 * it appears only after identify. Several boards with no default stay
 * unselected until the visitor picks one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { WidgetHomeProps } from '../widget-home-animated'

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
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    motion: new Proxy(
      {},
      { get: (_target, prop) => (typeof prop === 'string' ? make(prop) : undefined) }
    ),
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

describe('widget compose board', () => {
  beforeEach(() => {
    auth.sessionVersion = 0
    auth.isIdentified = false
    auth.user = null
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

  it('shows the only board and enables Submit once the title is filled', () => {
    renderHome({ boards: [ideas], boardPermissions: allow(ideas.id) })
    expect(screen.queryByText('Posting to')).toBeNull()

    typeTitle('Testing.')

    expect(screen.getByText('Posting to')).toBeTruthy()
    expect(screen.getByRole('combobox')).toHaveValue(ideas.id)
    expect(screen.getByRole('option', { name: 'Feature Requests' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()
  })

  it('adopts the single board after identify and posts to it without a manual pick', async () => {
    const view = renderHome({ boards: [], confirmedBoardSlugs: null })
    typeTitle('Testing.')
    expect(screen.queryByText('Posting to')).toBeNull()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()

    auth.sessionVersion = 1
    auth.isIdentified = true
    auth.user = { name: 'Ada Example', email: 'ada@example.com' }
    view.rerender(
      <WidgetHomeAnimated
        initialPosts={[]}
        statuses={[]}
        boards={[ideas]}
        boardPermissions={allow(ideas.id)}
        defaultBoard="feature-requests-1"
        confirmedBoardSlugs={['feature-requests-1']}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toHaveValue(ideas.id)
    })
    expect(screen.getByText('Posting to')).toBeTruthy()
    expect(screen.getByText(/Posting as/)).toBeTruthy()
    expect(screen.getByText('Ada Example')).toBeTruthy()
    expect(screen.queryByText('Choose a board to post')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(createPost).toHaveBeenCalled())
    expect(createPost.mock.calls[0]?.[0]).toMatchObject({
      data: { boardId: ideas.id, title: 'Testing.' },
    })
  })

  it('keeps Submit disabled until a board is chosen when several have no default', async () => {
    auth.sessionVersion = 1
    auth.isIdentified = true
    auth.user = { name: 'Ada Example', email: 'ada@example.com' }
    renderHome({
      boards: [ideas, bugs],
      boardPermissions: { ...allow(ideas.id), ...allow(bugs.id) },
      confirmedBoardSlugs: ['feature-requests-1', 'bug-reports'],
    })
    typeTitle('Testing.')

    expect(screen.getByText('Posting to')).toBeTruthy()
    expect(screen.getByText('Choose a board to post')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: bugs.id } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled())
    expect(screen.queryByText('Choose a board to post')).toBeNull()
  })
})
