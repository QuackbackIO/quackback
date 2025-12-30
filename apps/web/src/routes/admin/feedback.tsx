import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { requireAuthenticatedWorkspace } from '@/lib/workspace'
import { listInboxPosts } from '@/lib/posts'
import { listTags } from '@/lib/tags'
import { listStatuses } from '@/lib/statuses'
import { listBoards } from '@/lib/boards'
import { listTeamMembers } from '@/lib/members'
import { InboxContainer } from '@/app/admin/feedback/inbox-container'
import { type BoardId, type TagId, type MemberId } from '@quackback/ids'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

const searchSchema = z.object({
  board: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  status: z.array(z.string()).optional(),
  owner: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minVotes: z.string().optional(),
  sort: z.enum(['newest', 'oldest', 'votes']).optional().default('newest'),
})

export const Route = createFileRoute('/admin/feedback')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    board: search.board,
    tags: search.tags,
    status: search.status,
    owner: search.owner,
    search: search.search,
    dateFrom: search.dateFrom,
    dateTo: search.dateTo,
    minVotes: search.minVotes,
    sort: search.sort,
  }),
  errorComponent: FeedbackErrorComponent,
  loader: async ({ deps }) => {
    // Settings is validated in root layout
    const { user: currentUser, member } = await requireAuthenticatedWorkspace()

    // Check if org has boards - if not, redirect to onboarding
    const boardsResult = await listBoards()
    const orgBoards = boardsResult.success ? boardsResult.value : []

    if (orgBoards.length === 0) {
      throw redirect({ to: '/onboarding' })
    }

    // Parse filter params
    const boardFilterIds = (deps.board || []) as BoardId[]
    const tagFilterIds = (deps.tags || []) as TagId[]
    const statusFilterSlugs = deps.status || []
    const ownerFilterId = deps.owner

    // Fetch initial posts with filters from URL using PostService
    const postsResult = await listInboxPosts({
      boardIds: boardFilterIds.length > 0 ? boardFilterIds : undefined,
      statusSlugs: statusFilterSlugs.length > 0 ? statusFilterSlugs : undefined,
      tagIds: tagFilterIds.length > 0 ? tagFilterIds : undefined,
      ownerId: ownerFilterId === 'unassigned' ? null : (ownerFilterId as MemberId | undefined),
      search: deps.search,
      dateFrom: deps.dateFrom ? new Date(deps.dateFrom) : undefined,
      dateTo: deps.dateTo ? new Date(deps.dateTo) : undefined,
      minVotes: deps.minVotes ? parseInt(deps.minVotes, 10) : undefined,
      sort: deps.sort,
      page: 1,
      limit: 20,
    })

    const initialPosts = postsResult.success
      ? postsResult.value
      : { items: [], total: 0, hasMore: false }

    // Fetch tags for this organization using TagService
    const tagsResult = await listTags()
    const orgTags = tagsResult.success ? tagsResult.value : []

    // Fetch statuses for this organization using StatusService
    const statusesResult = await listStatuses()
    const orgStatuses = statusesResult.success ? statusesResult.value : []

    // Fetch team members using MemberService (returns TypeIDs directly)
    const membersResult = await listTeamMembers()
    const teamMembers = membersResult.success ? membersResult.value : []

    // Type the contentJson field for serialization
    const serializedPosts = {
      ...initialPosts,
      items: initialPosts.items.map((p) => ({
        ...p,
        contentJson: (p.contentJson ?? {}) as Record<string, unknown>,
      })),
    }

    // Type the boards settings field for serialization
    const serializedBoards = orgBoards.map((b) => ({
      ...b,
      settings: (b.settings ?? {}) as Record<string, unknown>,
    }))

    return {
      initialPosts: serializedPosts,
      boards: serializedBoards,
      tags: orgTags,
      statuses: orgStatuses,
      members: teamMembers,
      currentUser: {
        name: currentUser.name,
        email: currentUser.email,
        memberId: member.id,
      },
    }
  },
  component: FeedbackInboxPage,
})

function FeedbackErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[400px] p-4">
      <Alert variant="destructive" className="max-w-2xl">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Failed to load feedback</AlertTitle>
        <AlertDescription className="mt-2">
          <p className="mb-4">{error.message}</p>
          <Button onClick={reset} variant="outline" size="sm">
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}

function FeedbackInboxPage() {
  const { initialPosts, boards, tags, statuses, members, currentUser } = Route.useLoaderData()

  return (
    <InboxContainer
      initialPosts={initialPosts}
      boards={boards}
      tags={tags}
      statuses={statuses}
      members={members}
      currentUser={currentUser}
    />
  )
}
