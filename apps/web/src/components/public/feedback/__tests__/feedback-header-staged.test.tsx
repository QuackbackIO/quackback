// @vitest-environment happy-dom
/**
 * Home's composer opens in place. At rest it is one line, the prompt and the
 * brand's button, and focusing it keeps it so. Once someone types, ideas like
 * theirs come first ("Already asked? Vote instead"), then the board, details
 * and toolbar: after "Not these", the button, or a search that found nothing.
 * The search never stands in the way of posting. The feed's composer opens on
 * focus, as it always has.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const { similar } = vi.hoisted(() => ({
  similar: {
    // What the search answers for a title, and whether it has caught up with it.
    answer: (_title: string) => ({ posts: [] as unknown[], settled: false }),
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn() }),
  useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
    const context = { session: null }
    return opts?.select ? opts.select(context as never) : context
  },
}))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  usePortalMediaUpload: () => ({ upload: vi.fn() }),
}))
vi.mock('@/lib/client/mutations/portal-posts', () => ({
  useCreatePublicPost: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopover: () => ({ openAuthPopover: vi.fn() }),
}))
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({ useAuthBroadcast: () => {} }))
vi.mock('@/lib/client/hooks/use-similar-posts', () => ({
  useSimilarPosts: ({ title, enabled }: { title: string; enabled?: boolean }) =>
    enabled === false ? { posts: [], settled: false } : similar.answer(title),
}))
vi.mock('@/lib/client/hooks/use-ensure-anon-session', () => ({
  useEnsureAnonSession: () => async () => true,
}))
vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))
vi.mock('@/lib/client/queries/portal', () => ({ removeViewerScopedPortalQueries: vi.fn() }))
vi.mock('@/components/public/vote-button', () => ({
  VoteButton: ({ voteCount }: { voteCount: number }) => <span>{voteCount} votes</span>,
}))
vi.mock('@/components/public/feedback/posting-to-board', () => ({
  PostingToBoard: () => <div data-testid="board" />,
}))
vi.mock('framer-motion', async () => {
  const { createElement, forwardRef } = await import('react')
  const MOTION_PROPS = new Set(['initial', 'animate', 'exit', 'transition', 'variants', 'layout'])
  const make = (tag: string) =>
    forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
      const { children, ...rest } = props
      const dom: Record<string, unknown> = { ref }
      for (const [key, value] of Object.entries(rest)) if (!MOTION_PROPS.has(key)) dom[key] = value
      return createElement(tag, dom, children as ReactNode)
    })
  const proxy = new Proxy(
    {},
    { get: (_target, prop) => (typeof prop === 'string' ? make(prop) : undefined) }
  )
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    MotionConfig: ({ children }: { children?: ReactNode }) => children,
    motion: proxy,
    m: proxy,
  }
})
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => <div data-testid="editor" />,
}))

import { FeedbackHeaderAnimated, type FeedbackHeaderProps } from '../feedback-header-animated'

const BOARD = { id: 'board_1', name: 'Ideas', slug: 'ideas' }
const MATCHES = [
  {
    id: 'post_1',
    title: 'Export your data to a spreadsheet',
    boardSlug: 'ideas',
    voteCount: 88,
    status: { name: 'Complete', color: '#22c55e' },
  },
  {
    id: 'post_2',
    title: 'Scheduled exports',
    boardSlug: 'ideas',
    voteCount: 41,
    status: { name: 'Planned', color: '#f59e0b' },
  },
]

afterEach(() => {
  cleanup()
  similar.answer = () => ({ posts: [], settled: false })
})

function renderComposer(props: Partial<FeedbackHeaderProps> = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <FeedbackHeaderAnimated
          workspaceName=""
          boards={[BOARD]}
          defaultBoardId={BOARD.id}
          boardPermissions={{ [BOARD.id]: { canSubmit: true, canVote: true } }}
          place="band"
          {...props}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
}

const title = () => screen.getByRole('textbox', { name: 'Post title' })
const type = (value: string) => fireEvent.change(title(), { target: { value } })
// The board picker draws at once when the details open; the editor loads lazily after it.
const details = () => screen.queryByTestId('board')

describe('Home’s composer at rest', () => {
  it('is one line, the prompt and the brand’s button, and stays so on focus', () => {
    renderComposer()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
    fireEvent.focus(title())
    expect(details()).toBeNull()
    expect(screen.queryByTestId('board')).toBeNull()
    expect(screen.queryByText('Already asked? Vote instead')).toBeNull()
  })

  it('opens at once from its button, never waiting on the search', async () => {
    renderComposer()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByTestId('editor')).toBeTruthy()
    expect(screen.getByTestId('board')).toBeTruthy()
  })
})

describe('typing in Home’s composer', () => {
  it('shows ideas like it first, with their votes and status, before any details', () => {
    similar.answer = (typed) => ({ posts: typed.length >= 5 ? MATCHES : [], settled: true })
    renderComposer()
    type('Export to spreadsheet')
    expect(screen.getByText('Already asked? Vote instead')).toBeTruthy()
    expect(screen.getByText('Export your data to a spreadsheet')).toBeTruthy()
    expect(screen.getByText('88 votes')).toBeTruthy()
    expect(screen.getByText('Planned')).toBeTruthy()
    expect(details()).toBeNull()
    // The brand's button stays on the line, so posting is a click away.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })

  it('goes on to the board and details from “Not these”, the ideas staying above them', async () => {
    similar.answer = () => ({ posts: MATCHES, settled: true })
    renderComposer()
    type('Export to spreadsheet')
    fireEvent.click(screen.getByRole('button', { name: 'Not these: add details and post' }))
    const editor = await screen.findByTestId('editor')
    const board = screen.getByTestId('board')
    const heading = screen.getByText('Already asked? Vote instead')
    expect(heading.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(board.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Not these: add details and post' })).toBeNull()
  })

  it('goes on to the details by itself once the search finds nothing like it', async () => {
    similar.answer = (typed) => ({ posts: [], settled: typed.length >= 5 })
    renderComposer()
    type('Expo')
    expect(screen.queryByTestId('board')).toBeNull()
    type('Export to spreadsheet')
    expect(await screen.findByTestId('editor')).toBeTruthy()
    expect(screen.queryByText('Already asked? Vote instead')).toBeNull()
  })

  it('waits for the search to catch up before going on', () => {
    similar.answer = () => ({ posts: [], settled: false })
    renderComposer()
    type('Export to spreadsheet')
    expect(details()).toBeNull()
  })
})

describe('Home’s composer opened by a call to action', () => {
  it('starts open, and gives the call to action back on Cancel', async () => {
    const onClose = vi.fn()
    renderComposer({ startOpen: true, onClose })
    expect(await screen.findByTestId('editor')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('the feed’s composer', () => {
  it('still opens on focus', async () => {
    renderComposer({ place: 'feed' })
    fireEvent.focus(title())
    expect(await screen.findByTestId('editor')).toBeTruthy()
  })
})
