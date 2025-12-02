import { redirect } from 'next/navigation'
import { requireTenant } from '@/lib/tenant'
import {
  db,
  boards,
  member,
  user,
  eq,
  getInboxPostList,
  getTagsByOrganization,
} from '@quackback/db'
import { InboxContainer } from './inbox-container'

export default async function FeedbackInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { organization } = await requireTenant()
  const params = await searchParams

  // Check if org has boards - if not, redirect to onboarding
  const orgBoards = await db.query.boards.findMany({
    where: eq(boards.organizationId, organization.id),
    orderBy: (boards, { asc }) => [asc(boards.name)],
  })

  if (orgBoards.length === 0) {
    redirect('/onboarding')
  }

  // Parse filter params
  // nuqs uses comma-separated values for arrays in the URL
  const getArrayParam = (key: string): string[] => {
    const value = params[key]
    if (Array.isArray(value)) return value.flatMap(v => v.split(','))
    if (typeof value === 'string') return value.split(',').filter(Boolean)
    return []
  }

  const getStringParam = (key: string): string | undefined => {
    const value = params[key]
    return typeof value === 'string' ? value : undefined
  }

  // Fetch initial posts with filters from URL
  const initialPosts = await getInboxPostList({
    organizationId: organization.id,
    boardIds: getArrayParam('board').length > 0 ? getArrayParam('board') : undefined,
    status:
      getArrayParam('status').length > 0
        ? (getArrayParam('status') as ('open' | 'under_review' | 'planned' | 'in_progress' | 'complete' | 'closed')[])
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
  })

  // Fetch tags for this organization
  const orgTags = await getTagsByOrganization(organization.id)

  // Fetch team members
  const teamMembers = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, organization.id))

  return (
    <InboxContainer
      organizationId={organization.id}
      initialPosts={initialPosts}
      boards={orgBoards}
      tags={orgTags}
      members={teamMembers}
    />
  )
}
