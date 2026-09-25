// @vitest-environment happy-dom
/**
 * Writing a new post's details is the editor's work alone: a keystroke must
 * not re-render the feedback header around the editor. The post still carries
 * exactly what was typed, and a cancelled draft is gone the next time the
 * composer opens. The editor is a stub that counts its renders (it is not
 * memoized, so it renders whenever its host does) and hands the test its
 * change callbacks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

type Doc = { json(): unknown; html(): string; markdown(): string }

const { createPost, editor } = vi.hoisted(() => ({
  createPost: vi.fn(),
  editor: {
    renders: 0,
    onChange: null as ((json: unknown, html: string, markdown: string) => void) | null,
    onDocumentChange: null as ((document: Doc) => void) | null,
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn() }),
  useRouteContext: () => ({
    session: { user: { name: 'Ada Example', email: 'ada@example.com', principalType: 'user' } },
  }),
}))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  usePortalMediaUpload: () => ({ upload: vi.fn() }),
}))
vi.mock('@/lib/client/mutations/portal-posts', () => ({
  useCreatePublicPost: () => ({ mutateAsync: createPost, isPending: false }),
}))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopover: () => ({ openAuthPopover: vi.fn() }),
}))
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({ useAuthBroadcast: () => {} }))
vi.mock('@/lib/client/hooks/use-similar-posts', () => ({
  useSimilarPosts: () => ({ posts: [] }),
}))
vi.mock('@/lib/client/hooks/use-ensure-anon-session', () => ({
  useEnsureAnonSession: () => async () => true,
}))
vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))
vi.mock('@/lib/client/queries/portal', () => ({ removeViewerScopedPortalQueries: vi.fn() }))
vi.mock('@/components/public/similar-posts-card', () => ({ SimilarPostsCard: () => null }))
vi.mock('@/components/public/feedback/posting-to-board', () => ({ PostingToBoard: () => null }))
vi.mock('framer-motion', async () => {
  const { createElement, forwardRef } = await import('react')
  const MOTION_PROPS = new Set(['initial', 'animate', 'exit', 'transition', 'variants', 'layout'])
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
    motion: proxy,
    m: proxy,
  }
})
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: (props: {
    onChange?: typeof editor.onChange
    onDocumentChange?: typeof editor.onDocumentChange
  }) => {
    editor.renders++
    editor.onChange = props.onChange ?? null
    editor.onDocumentChange = props.onDocumentChange ?? null
    return <div data-testid="editor" />
  },
}))

import { FeedbackHeaderAnimated } from '../feedback-header-animated'

const BOARD = { id: 'board_1', name: 'Ideas', slug: 'ideas' }

function renderHeader() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <FeedbackHeaderAnimated
          workspaceName="Acme"
          boards={[BOARD]}
          defaultBoardId={BOARD.id}
          boardPermissions={{ [BOARD.id]: { canSubmit: true, canVote: true } }}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
}

function typeTitle(value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Feedback title' }), {
    target: { value },
  })
}

function paragraph(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

/** Feed the editor's change callback one character at a time. */
function typeDetails(text: string) {
  for (let i = 1; i <= text.length; i++) {
    const typed = text.slice(0, i)
    const json = paragraph(typed)
    const html = `<p>${typed}</p>`
    act(() => {
      if (editor.onDocumentChange) {
        editor.onDocumentChange({ json: () => json, html: () => html, markdown: () => typed })
      } else {
        editor.onChange!(json, html, typed)
      }
    })
  }
}

beforeEach(() => {
  createPost.mockReset()
  createPost.mockResolvedValue({ id: 'post_1', board: { slug: 'ideas' } })
})

afterEach(() => {
  cleanup()
  editor.renders = 0
  editor.onChange = null
  editor.onDocumentChange = null
})

describe('feedback header post composer', () => {
  it('does not re-render the header per keystroke in the details', async () => {
    renderHeader()
    typeTitle('Dark mode')
    await screen.findByTestId('editor')

    editor.renders = 0
    typeDetails('Please add it')
    expect(editor.renders).toBe(0)
  })

  it('posts the details as typed', async () => {
    renderHeader()
    typeTitle('Dark mode')
    await screen.findByTestId('editor')
    typeDetails('Please add it')

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(1))
    expect(createPost.mock.calls[0]![0]).toEqual({
      boardId: BOARD.id,
      title: 'Dark mode',
      content: 'Please add it',
      contentJson: paragraph('Please add it'),
    })
  })

  it('starts over after a cancel', async () => {
    renderHeader()
    typeTitle('Dark mode')
    await screen.findByTestId('editor')
    typeDetails('Please add it')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    typeTitle('Light mode')
    await screen.findByTestId('editor')
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(1))
    expect(createPost.mock.calls[0]![0]).toEqual({
      boardId: BOARD.id,
      title: 'Light mode',
      content: '',
      contentJson: null,
    })
  })
})
