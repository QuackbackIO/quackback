// @vitest-environment happy-dom
/**
 * Who the idea composer says you post as. An anonymous visitor posts under
 * their generated name, and is not offered "sign out", which means nothing to
 * someone who never signed in.
 */
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const { createPost, editor, similar, boardPicker, viewer } = vi.hoisted(() => ({
  createPost: vi.fn(),
  editor: { renders: 0, onChange: null as unknown, onDocumentChange: null as unknown },
  similar: { searches: [] as unknown[], shown: [] as boolean[] },
  boardPicker: { renders: 0 },
  viewer: { session: null as unknown },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn() }),
  useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
    const context = { session: viewer.session }
    return opts?.select ? opts.select(context as never) : context
  },
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
  useSimilarPosts: (options: { title: string; enabled?: boolean }) => {
    similar.searches.push({ title: options.title, enabled: options.enabled })
    return { posts: [] }
  },
}))
vi.mock('@/lib/client/hooks/use-ensure-anon-session', () => ({
  useEnsureAnonSession: () => async () => true,
}))
vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))
vi.mock('@/lib/client/queries/portal', () => ({ removeViewerScopedPortalQueries: vi.fn() }))
vi.mock('@/components/public/similar-posts-card', () => ({
  SimilarPostsCard: ({ show }: { show: boolean }) => {
    similar.shown.push(show)
    return null
  },
}))
vi.mock('@/components/public/feedback/posting-to-board', () => ({
  PostingToBoard: () => {
    boardPicker.renders++
    return null
  },
}))
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

function openComposer(user?: { name: string; email: string }) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <FeedbackHeaderAnimated
          workspaceName="Acme"
          boards={[BOARD]}
          defaultBoardId={BOARD.id}
          user={user ?? null}
          boardPermissions={{ [BOARD.id]: { canSubmit: true, canVote: true } }}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
  fireEvent.focus(screen.getByRole('textbox', { name: 'Feedback title' }))
}

afterEach(() => {
  cleanup()
  viewer.session = null
})

const anonymous = (displayName: string | null) => ({
  user: {
    name: 'Anonymous',
    email: 'temp-1@anon.example',
    principalType: 'anonymous',
    displayName,
  },
})

it('names an anonymous visitor by their generated name, with no sign out', () => {
  viewer.session = anonymous('Snowy Cardinal')
  openComposer({ name: 'Anonymous', email: 'temp-1@anon.example' })
  expect(screen.getByText('Snowy Cardinal')).toBeTruthy()
  expect(screen.queryByText(/Anonymous/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'sign out' })).toBeNull()
})

it('says posting anonymously when the visitor has no generated name', () => {
  viewer.session = anonymous(null)
  openComposer({ name: 'Anonymous', email: 'temp-1@anon.example' })
  expect(screen.getByText('Posting anonymously')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'sign out' })).toBeNull()
})

it('keeps sign out for a signed-in person', () => {
  viewer.session = {
    user: { name: 'Ada Example', email: 'ada@example.com', principalType: 'user' },
  }
  openComposer()
  expect(screen.getByText('Ada Example')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'sign out' })).toBeTruthy()
})
