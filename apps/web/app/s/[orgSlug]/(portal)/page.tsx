import { getOrganizationBySlug } from '@/lib/tenant'
import { getSession } from '@/lib/auth/server'
import { getBulkMemberAvatarData } from '@/lib/avatar'
import { getBoardService, getPostService, getStatusService, getTagService } from '@/lib/services'
import { db, member, eq, and } from '@/lib/db'
import { FeedbackContainer } from './feedback-container'
import { getUserIdentifier, getMemberIdentifier } from '@/lib/user-identifier'

interface PublicPortalPageProps {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{
    board?: string
    search?: string
    sort?: 'top' | 'new' | 'trending'
  }>
}

/**
 * Public portal page - shows feedback boards and posts
 * This page is rendered for tenant domain root: acme.quackback.io/
 */
export default async function PublicPortalPage({ params, searchParams }: PublicPortalPageProps) {
  const { orgSlug } = await params
  const org = await getOrganizationBySlug(orgSlug)

  // Org validation is done in parent tenant layout
  if (!org) {
    return null
  }

  const { board, search, sort = 'top' } = await searchParams
  const session = await getSession()

  // Get user identifier - use member ID for authenticated users, anonymous cookie for others
  let userIdentifier = await getUserIdentifier()
  if (session?.user) {
    const memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, session.user.id), eq(member.organizationId, org.id)),
    })
    if (memberRecord) {
      userIdentifier = getMemberIdentifier(memberRecord.id)
    }
  }

  // Fetch data in parallel using domain services
  const [boardsResult, postsResult, statusesResult, tagsResult] = await Promise.all([
    getBoardService().listPublicBoardsWithStats(org.id),
    getPostService().listPublicPosts({
      organizationId: org.id,
      boardSlug: board,
      search,
      sort,
      page: 1,
      limit: 20,
    }),
    getStatusService().listPublicStatuses(org.id),
    getTagService().listPublicTags(org.id),
  ])

  // Services now return TypeIDs directly
  const boards = boardsResult.success ? boardsResult.value : []
  const { items: posts, hasMore } = postsResult.success
    ? postsResult.value
    : { items: [], hasMore: false }
  const statuses = statusesResult.success ? statusesResult.value : []
  const tags = tagsResult.success ? tagsResult.value : []

  // Get user's voted posts - service now returns TypeID set directly
  const postIds = posts.map((p) => p.id)
  const votedPostIdsResult = await getPostService().getUserVotedPostIds(postIds, userIdentifier)
  const votedPostIds = votedPostIdsResult.success ? Array.from(votedPostIdsResult.value) : []

  // Get avatar URLs for post authors (base64 for SSR, no flicker)
  const postMemberIds = posts.map((p) => p.memberId)
  const postAvatarMap = await getBulkMemberAvatarData(postMemberIds)

  // Convert avatar map to record (keys are already TypeIDs)
  const postAvatarUrls = Object.fromEntries(postAvatarMap)

  return (
    <main className="mx-auto max-w-5xl w-full flex-1 py-6 sm:px-6 lg:px-8">
      <FeedbackContainer
        organizationId={org.id}
        organizationName={org.name}
        boards={boards}
        posts={posts}
        statuses={statuses}
        tags={tags}
        hasMore={hasMore}
        votedPostIds={votedPostIds}
        postAvatarUrls={postAvatarUrls}
        currentBoard={board}
        currentSearch={search}
        currentSort={sort}
        defaultBoardId={boards[0]?.id}
        user={session?.user ? { name: session.user.name, email: session.user.email } : null}
      />
    </main>
  )
}
