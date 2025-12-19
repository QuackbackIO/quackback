import { redirect } from 'next/navigation'
import { requireAuthenticatedTenantBySlug } from '@/lib/tenant'
import {
  getPostService,
  getTagService,
  getStatusService,
  getBoardService,
  getMemberService,
} from '@/lib/services'
import { InboxContainer } from './inbox-container'
import { type BoardId, type TagId, type MemberId } from '@quackback/ids'

interface FeedbackInboxPageProps {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function FeedbackInboxPage({ params, searchParams }: FeedbackInboxPageProps) {
  const { orgSlug } = await params
  const {
    workspace,
    user: currentUser,
    serviceContext,
  } = await requireAuthenticatedTenantBySlug(orgSlug)
  const searchParamsResolved = await searchParams

  // Check if org has boards - if not, redirect to onboarding
  const boardsResult = await getBoardService().listBoards(serviceContext)
  const orgBoards = boardsResult.success ? boardsResult.value : []

  if (orgBoards.length === 0) {
    redirect('/onboarding')
  }

  // Parse filter params
  // nuqs uses comma-separated values for arrays in the URL
  const getArrayParam = (key: string): string[] => {
    const value = searchParamsResolved[key]
    if (Array.isArray(value)) return value.flatMap((v) => v.split(','))
    if (typeof value === 'string') return value.split(',').filter(Boolean)
    return []
  }

  const getStringParam = (key: string): string | undefined => {
    const value = searchParamsResolved[key]
    return typeof value === 'string' ? value : undefined
  }

  // Fetch initial posts with filters from URL using PostService
  const boardFilterIds = getArrayParam('board') as BoardId[]
  const tagFilterIds = getArrayParam('tags') as TagId[]
  const statusFilterSlugs = getArrayParam('status')
  const ownerFilterId = getStringParam('owner')
  const postsResult = await getPostService().listInboxPosts(
    {
      boardIds: boardFilterIds.length > 0 ? boardFilterIds : undefined,
      statusSlugs: statusFilterSlugs.length > 0 ? statusFilterSlugs : undefined,
      tagIds: tagFilterIds.length > 0 ? tagFilterIds : undefined,
      ownerId: ownerFilterId === 'unassigned' ? null : (ownerFilterId as MemberId | undefined),
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

  // Fetch team members using MemberService (returns TypeIDs directly)
  const membersResult = await getMemberService().listTeamMembers(workspace.id)
  const teamMembers = membersResult.success ? membersResult.value : []

  return (
    <InboxContainer
      workspaceId={workspace.id}
      initialPosts={initialPosts}
      boards={orgBoards}
      tags={orgTags}
      statuses={orgStatuses}
      members={teamMembers}
      currentUser={{ name: currentUser.name, email: currentUser.email }}
    />
  )
}
