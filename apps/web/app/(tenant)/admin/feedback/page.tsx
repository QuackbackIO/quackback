import { redirect } from 'next/navigation'
import { requireAuthenticatedTenant } from '@/lib/tenant'
import {
  getPostService,
  getTagService,
  getStatusService,
  getBoardService,
  getMemberService,
} from '@/lib/services'
import { InboxContainer } from './inbox-container'

export default async function FeedbackInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { organization, user: currentUser, serviceContext } = await requireAuthenticatedTenant()
  const params = await searchParams

  // Check if org has boards - if not, redirect to onboarding
  const boardsResult = await getBoardService().listBoards(serviceContext)
  const orgBoards = boardsResult.success ? boardsResult.value : []

  if (orgBoards.length === 0) {
    redirect('/onboarding')
  }

  // Parse filter params
  // nuqs uses comma-separated values for arrays in the URL
  const getArrayParam = (key: string): string[] => {
    const value = params[key]
    if (Array.isArray(value)) return value.flatMap((v) => v.split(','))
    if (typeof value === 'string') return value.split(',').filter(Boolean)
    return []
  }

  const getStringParam = (key: string): string | undefined => {
    const value = params[key]
    return typeof value === 'string' ? value : undefined
  }

  // Fetch initial posts with filters from URL using PostService
  const postsResult = await getPostService().listInboxPosts(
    {
      boardIds: getArrayParam('board').length > 0 ? getArrayParam('board') : undefined,
      status:
        getArrayParam('status').length > 0
          ? (getArrayParam('status') as (
              | 'open'
              | 'under_review'
              | 'planned'
              | 'in_progress'
              | 'complete'
              | 'closed'
            )[])
          : undefined,
      tagIds: getArrayParam('tags').length > 0 ? getArrayParam('tags') : undefined,
      ownerId: getStringParam('owner') === 'unassigned' ? null : getStringParam('owner'),
      search: getStringParam('search'),
      dateFrom: getStringParam('dateFrom') ? new Date(getStringParam('dateFrom')!) : undefined,
      dateTo: getStringParam('dateTo') ? new Date(getStringParam('dateTo')!) : undefined,
      minVotes: getStringParam('minVotes') ? parseInt(getStringParam('minVotes')!, 10) : undefined,
      sort: (getStringParam('sort') as 'newest' | 'oldest' | 'votes') || 'newest',
      page: 1,
      limit: 20,
    },
    serviceContext
  )

  const initialPosts = postsResult.success
    ? postsResult.value
    : { items: [], total: 0, hasMore: false }

  // Fetch tags for this organization using TagService
  const tagsResult = await getTagService().listTags(serviceContext)
  const orgTags = tagsResult.success ? tagsResult.value : []

  // Fetch statuses for this organization using StatusService
  const statusesResult = await getStatusService().listStatuses(serviceContext)
  const orgStatuses = statusesResult.success ? statusesResult.value : []

  // Fetch team members using MemberService
  const membersResult = await getMemberService().listTeamMembers(organization.id)
  const teamMembers = membersResult.success ? membersResult.value : []

  return (
    <InboxContainer
      organizationId={organization.id}
      initialPosts={initialPosts}
      boards={orgBoards}
      tags={orgTags}
      statuses={orgStatuses}
      members={teamMembers}
      currentUser={{ name: currentUser.name, email: currentUser.email }}
    />
  )
}
