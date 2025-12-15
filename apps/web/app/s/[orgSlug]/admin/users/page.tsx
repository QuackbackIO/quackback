import { requireAuthenticatedTenantBySlug } from '@/lib/tenant'
import { getUserService } from '@/lib/services'
import { UsersContainer } from './users-container'
import { fromUuid } from '@quackback/ids'

export default async function UsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { orgSlug } = await params
  const { organization, member } = await requireAuthenticatedTenantBySlug(orgSlug)
  const paramsResolved = await searchParams

  const getStringParam = (key: string): string | undefined => {
    const value = paramsResolved[key]
    return typeof value === 'string' ? value : undefined
  }

  // Parse filter params
  const search = getStringParam('search')
  const verifiedParam = getStringParam('verified')
  const verified = verifiedParam === 'true' ? true : verifiedParam === 'false' ? false : undefined
  const dateFrom = getStringParam('dateFrom')
  const dateTo = getStringParam('dateTo')
  const sort = (getStringParam('sort') as 'newest' | 'oldest' | 'most_active' | 'name') || 'newest'

  // Fetch initial users with filters from URL
  const usersResult = await getUserService().listPortalUsers(organization.id, {
    search,
    verified,
    dateFrom: dateFrom ? new Date(dateFrom) : undefined,
    dateTo: dateTo ? new Date(dateTo) : undefined,
    sort,
    page: 1,
    limit: 20,
  })

  const initialUsersRaw = usersResult.success
    ? usersResult.value
    : { items: [], total: 0, hasMore: false }

  // Transform Better-auth IDs to TypeIDs for client components
  const initialUsers = {
    ...initialUsersRaw,
    items: initialUsersRaw.items.map((user) => ({
      ...user,
      memberId: fromUuid('member', user.memberId),
      userId: fromUuid('user', user.userId),
    })),
  } as typeof initialUsersRaw

  return (
    <UsersContainer
      organizationId={organization.id}
      initialUsers={initialUsers}
      currentMemberRole={member.role}
    />
  )
}
