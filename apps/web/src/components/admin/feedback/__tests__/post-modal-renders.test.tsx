// @vitest-environment happy-dom
/**
 * The admin post modal renders its content (two rich-text editors, the
 * metadata sidebar, the comment thread) once when it opens, and not again for
 * what does not concern it: a navigation that leaves the post alone re-runs
 * the admin route's beforeLoad and hands the tree a fresh route context and
 * location, and none of that changes what the modal shows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense, type ReactNode } from 'react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
} from '@tanstack/react-router'
import type { PostId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'

// The modal's heavy children, reduced to render counters: each renders
// whenever the modal content does.
const renders = { editor: 0, sidebar: 0 }
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => {
    renders.editor++
    return <div data-testid="editor" />
  },
}))
vi.mock('@/components/public/post-detail/metadata-sidebar', () => ({
  MetadataSidebar: () => {
    renders.sidebar++
    return null
  },
  MetadataSidebarSkeleton: () => null,
  ManagePostActions: () => null,
}))
vi.mock('@/components/public/post-detail/comments-section', () => ({
  CommentsSection: () => null,
  CommentsSectionSkeleton: () => null,
}))
vi.mock('@/components/admin/feedback/merge-section', () => ({
  MergeActions: () => null,
  MergeInfoBanner: () => null,
  MergeOthersDialog: () => null,
}))
vi.mock('@/components/admin/feedback/ai-summary-card', () => ({ AiSummaryCard: () => null }))
vi.mock('@/components/admin/feedback/similar-posts-card', () => ({
  SimilarPostsCard: () => null,
}))
vi.mock('@/components/admin/feedback/detail/post-activity-timeline', () => ({
  PostActivityTimeline: () => null,
}))
vi.mock('@/components/admin/feedback/customer-context-panel', () => ({
  CustomerContextPanel: () => null,
}))
vi.mock('@/components/public/post-detail/delete-post-dialog', () => ({
  DeletePostDialog: () => null,
}))
vi.mock('@/components/shared/url-modal-shell', () => ({
  UrlModalShell: ({ children, hasValidId }: { children: ReactNode; hasValidId: boolean }) =>
    hasValidId ? <Suspense fallback={null}>{children}</Suspense> : null,
}))
vi.mock('@/components/shared/modal-header', () => ({
  ModalHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/shared/modal-footer', () => ({ ModalFooter: () => null }))

const { PostModal } = await import('@/components/admin/entity-modals')
// The content chunk the modal loads on open, imported ahead so opening does
// not wait on its transform.
await import('../post-modal')
const { adminQueries } = await import('@/lib/client/queries/admin')
const { postOwnerQueries } = await import('@/lib/client/queries/post-owner')
const { mergeSuggestionQueries } = await import('@/lib/client/queries/signals')
const { postExternalLinksQuery } = await import('@/lib/client/hooks/use-post-external-links-query')

const POST = 'post_01h455vb4pex5vsknk084sn02q' as PostId
const USER = { name: 'Admin', email: 'admin@example.com', principalId: 'principal_admin' }

function seededClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(adminQueries.postDetail(POST).queryKey, {
    id: POST,
    title: 'A post',
    content: 'Body',
    contentJson: null,
    statusId: null,
    voteCount: 0,
    hasVoted: false,
    principalId: 'principal_author',
    ownerPrincipalId: null,
    authorName: 'Author',
    authorEmail: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    eta: null,
    board: { id: 'board_1', name: 'Board', slug: 'board' },
    tags: [],
    comments: [],
    pinnedComment: null,
    pinnedCommentId: null,
    moderationState: 'published',
    summaryJson: null,
    summaryUpdatedAt: null,
  } as never)
  client.setQueryData(adminQueries.tags().queryKey, [])
  client.setQueryData(adminQueries.statuses().queryKey, [])
  client.setQueryData(adminQueries.boards().queryKey, [])
  client.setQueryData(postOwnerQueries.candidates().queryKey, [])
  client.setQueryData(mergeSuggestionQueries.forPost(POST).queryKey, [])
  client.setQueryData(postExternalLinksQuery(POST).queryKey, [])
  return client
}

/** Mounts the modal the way the admin layout does: from the URL's `post`. */
function AdminProbe() {
  const postId = useRouterState({
    select: (s) => (s.location.search as { post?: string }).post,
  })
  return postId ? <PostModal postId={postId} currentUser={USER} /> : null
}

function buildRouter() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const adminRoute = createRoute({
    getParentRoute: () => rootRoute as never,
    path: '/admin',
    validateSearch: (search: Record<string, unknown>) => ({
      ...(typeof search.post === 'string' && { post: search.post }),
      ...(typeof search.sort === 'string' && { sort: search.sort }),
    }),
    // A fresh context object on every navigation, like the real beforeLoad.
    beforeLoad: () => ({
      principal: { role: 'admin' },
      permissions: [
        PERMISSIONS.POST_VIEW_PRIVATE,
        PERMISSIONS.POST_SET_OWNER,
        PERMISSIONS.INTEGRATION_MANAGE,
      ],
    }),
    component: AdminProbe,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([adminRoute as never]),
    history: createMemoryHistory({ initialEntries: [`/admin?post=${POST}`] }),
  })
}

afterEach(cleanup)

describe('PostModal renders', () => {
  it('renders the post once on open and not again for navigations that leave it alone', async () => {
    renders.editor = 0
    renders.sidebar = 0
    const router = buildRouter()
    render(
      <QueryClientProvider client={seededClient()}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    )
    await screen.findByTestId('editor')
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))

    expect(renders).toEqual({ editor: 1, sidebar: 1 })

    await act(() =>
      router.navigate({ to: '/admin', search: { post: POST, sort: 'votes' } } as never)
    )
    await act(() => router.invalidate())

    expect(renders).toEqual({ editor: 1, sidebar: 1 })
  })
})
