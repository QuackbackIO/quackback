import { requireAuthenticatedTenant } from '@/lib/tenant'
import { getUserService } from '@/lib/services'
import { UsersContainer } from './users-container'

export default async function UsersPage({
  params: _params,
  searchParams,
}: {
  params?: Promise<object>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  // Settings is validated in root layout
  const { member } = await requireAuthenticatedTenant()
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
  const usersResult = await getUserService().listPortalUsers({
    search,
    verified,
    dateFrom: dateFrom ? new Date(dateFrom) : undefined,
    dateTo: dateTo ? new Date(dateTo) : undefined,
    sort,
    page: 1,
    limit: 20,
  })

  const initialUsers = usersResult.success
    ? usersResult.value
    : { items: [], total: 0, hasMore: false }

  return <UsersContainer initialUsers={initialUsers} currentMemberRole={member.role} />
}
