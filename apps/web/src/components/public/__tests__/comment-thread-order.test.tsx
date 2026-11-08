// @vitest-environment happy-dom
/**
 * A post's comments read newest first, or oldest first where the design
 * asks; the pinned reply leads either way, and what comes before the list
 * (such as "Show more" for earlier comments) sits above it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { PublicCommentView } from '@/lib/client/queries/portal-detail'
import type { PostCommentId, PostId } from '@quackback/ids'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: unknown }) => children,
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
    const context = { settings: { name: 'Acme', brandingData: null }, session: null }
    return opts?.select ? opts.select(context as never) : context
  },
}))
vi.mock('../comment-form', () => ({ CommentForm: () => <div data-testid="composer" /> }))

import { CommentThread } from '../comment-thread'

afterEach(cleanup)

const comment = (id: string, day: number): PublicCommentView => ({
  id: id as PostCommentId,
  content: id,
  contentJson: null,
  authorName: 'Ada',
  principalId: null,
  createdAt: new Date(`2026-01-0${day}T00:00:00Z`),
  deletedAt: null,
  isRemovedByTeam: false,
  parentId: null,
  isTeamMember: false,
  isEdited: false,
  avatarUrl: null,
  replies: [],
  reactions: [],
})

const COMMENTS = [comment('comment_b', 2), comment('comment_c', 3), comment('comment_a', 1)]

function order(props: { oldestFirst?: boolean; pinned?: string; before?: React.ReactNode }) {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <CommentThread
          postId={'post_01h00000000000000000000000' as PostId}
          comments={COMMENTS}
          allowCommenting={false}
          pinnedCommentId={props.pinned}
          oldestFirst={props.oldestFirst}
          before={props.before}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
  return {
    ids: [...container.querySelectorAll('[id^="comment-"]')].map((node) => node.id),
    container,
  }
}

describe('the comments’ order', () => {
  it('reads newest first by default', () => {
    expect(order({}).ids).toEqual(['comment-comment_c', 'comment-comment_b', 'comment-comment_a'])
  })

  it('reads oldest first where the design asks', () => {
    expect(order({ oldestFirst: true }).ids).toEqual([
      'comment-comment_a',
      'comment-comment_b',
      'comment-comment_c',
    ])
  })

  it('leads with the pinned reply either way', () => {
    expect(order({ oldestFirst: true, pinned: 'comment_c' }).ids[0]).toBe('comment-comment_c')
    expect(order({ pinned: 'comment_a' }).ids[0]).toBe('comment-comment_a')
  })

  it('puts what comes before the list above the first comment', () => {
    const { container } = order({ oldestFirst: true, before: <button>Show more</button> })
    const button = container.querySelector('button')!
    const first = container.querySelector('[id^="comment-"]')!
    expect(button.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
