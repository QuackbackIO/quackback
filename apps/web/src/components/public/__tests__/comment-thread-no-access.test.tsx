// @vitest-environment happy-dom
/**
 * A signed-in viewer the server won't let comment sees why, in place of the
 * composer: the board's generic denial, or on an author-only board the rule
 * that only the post author and the team can reply.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ReplyPolicy } from '@/lib/shared/db-types'
import type { PostId } from '@quackback/ids'

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

vi.mock('../comment-form', () => ({
  CommentForm: () => <div data-testid="composer" />,
}))

import { CommentThread } from '../comment-thread'

afterEach(cleanup)

const POST_ID = 'post_01h00000000000000000000000' as PostId
const AUTHOR_ONLY = 'Only the post author and team members can reply on this board'
const NO_ACCESS = "You don't have access to comment on this board"

function renderDenied(replyPolicy?: ReplyPolicy) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <CommentThread
          postId={POST_ID}
          comments={[]}
          allowCommenting={false}
          noAccess
          replyPolicy={replyPolicy}
          user={{ name: 'Viewer', email: 'viewer@example.com' }}
        />
      </IntlProvider>
    </QueryClientProvider>
  )
}

describe('CommentThread no-access notice', () => {
  it('names the author-only rule on an author-only board', () => {
    renderDenied('author-only')
    expect(screen.getByText(AUTHOR_ONLY)).toBeInTheDocument()
    expect(screen.queryByText(NO_ACCESS)).not.toBeInTheDocument()
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument()
  })

  it('keeps the generic denial when the board has no reply rule', () => {
    renderDenied(undefined)
    expect(screen.getByText(NO_ACCESS)).toBeInTheDocument()
    expect(screen.queryByText(AUTHOR_ONLY)).not.toBeInTheDocument()
  })
})
