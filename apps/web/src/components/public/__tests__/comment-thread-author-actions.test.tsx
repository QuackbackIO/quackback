// @vitest-environment happy-dom
/**
 * The author of a comment is offered Edit and Delete only while the server
 * would allow them: once a teammate replies, neither button shows. The
 * thread hides them at once when it can see the team reply, and otherwise
 * asks the server (a reply the viewer cannot see still locks the comment).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { PublicCommentView } from '@/lib/client/queries/portal-detail'
import type { PostCommentId, PostId, PrincipalId } from '@quackback/ids'

const permissions = vi.hoisted(() => ({
  value: { canEdit: true, canDelete: true } as { canEdit: boolean; canDelete: boolean },
  asked: [] as string[],
}))

vi.mock('@/lib/client/hooks/use-comments-query', () => ({
  useCommentPermissions: ({ commentId, enabled }: { commentId: string; enabled?: boolean }) => {
    if (enabled !== false) permissions.asked.push(commentId)
    return { data: enabled === false ? undefined : permissions.value }
  },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: unknown }) => children,
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
    const context = {
      settings: { name: 'Acme', brandingData: { logoUrl: null, name: 'Acme' } },
      session: null,
    }
    return opts?.select ? opts.select(context as never) : context
  },
}))

vi.mock('../comment-form', () => ({ CommentForm: () => null }))

import { CommentThread } from '../comment-thread'

afterEach(() => {
  cleanup()
  permissions.value = { canEdit: true, canDelete: true }
  permissions.asked.length = 0
})

const AUTHOR = 'principal_01h00000000000000000000000' as PrincipalId
const TEAMMATE = 'principal_01h00000000000000000000001' as PrincipalId

function comment(overrides: Partial<PublicCommentView>): PublicCommentView {
  return {
    id: 'comment_a' as PostCommentId,
    content: 'Mine',
    contentJson: null,
    authorName: 'Ada',
    principalId: AUTHOR,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    isRemovedByTeam: false,
    parentId: null,
    isTeamMember: false,
    isEdited: false,
    avatarUrl: null,
    replies: [],
    reactions: [],
    ...overrides,
  }
}

const teamReply = comment({
  id: 'comment_b' as PostCommentId,
  content: 'Team answer',
  authorName: 'Tess',
  principalId: TEAMMATE,
  parentId: 'comment_a' as PostCommentId,
  isTeamMember: true,
})

function renderThread(comments: PublicCommentView[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <CommentThread
          postId={'post_01h00000000000000000000000' as PostId}
          comments={comments}
          allowCommenting
          user={{ name: 'Ada', email: 'ada@example.com', principalId: AUTHOR }}
          onDeleteComment={vi.fn()}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
}

describe("the author's own comment", () => {
  it('offers Edit and Delete while nobody from the team has replied', () => {
    renderThread([comment({})])
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
  })

  it('offers neither once a teammate has replied', () => {
    permissions.value = { canEdit: false, canDelete: false }
    renderThread([comment({ replies: [teamReply] })])
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('hides them when the visible thread shows a team reply, even before the server answers', () => {
    // A stale "allowed" answer must not bring the buttons back.
    renderThread([comment({ replies: [teamReply] })])
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('follows the server when the reply that locks it is not visible to the author', () => {
    permissions.value = { canEdit: false, canDelete: false }
    renderThread([comment({})])
    expect(permissions.asked).toContain('comment_a')
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })
})
