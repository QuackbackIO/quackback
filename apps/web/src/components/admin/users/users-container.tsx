import { UsersLayout } from '@/components/admin/users/users-layout'
import { UsersFiltersPanel } from '@/components/admin/users/users-filters'
import { UsersList } from '@/components/admin/users/users-list'
import { UserDetail } from '@/components/admin/users/user-detail'
import { useUsersFilters } from '@/components/admin/users/use-users-filters'
import {
  usePortalUsers,
  useUserDetail,
  useRemovePortalUser,
  flattenUsers,
} from '@/lib/hooks/use-users-queries'
import type { PortalUserListResultView } from '@/lib/users'
import type { MemberId } from '@quackback/ids'

interface UsersContainerProps {
  initialUsers: PortalUserListResultView
  currentMemberRole: string
}

export function UsersContainer({ initialUsers, currentMemberRole }: UsersContainerProps) {
  // URL-based filter state
  const { filters, setFilters, clearFilters, selectedUserId, setSelectedUserId, hasActiveFilters } =
    useUsersFilters()

  // Server state - Users list (with infinite query for pagination)
  const {
    data: usersData,
    isLoading,
    isFetchingNextPage: isLoadingMore,
    hasNextPage: hasMore,
    fetchNextPage,
  } = usePortalUsers({
    filters,
    initialData: initialUsers,
  })

  const users = flattenUsers(usersData)

  // Server state - Selected user detail
  const { data: selectedUser, isLoading: isLoadingUser } = useUserDetail({
    memberId: selectedUserId as MemberId | null,
  })

  // Mutations
  const removePortalUser = useRemovePortalUser()

  // Handlers
  const handleLoadMore = () => {
    if (hasMore && !isLoadingMore) {
      fetchNextPage()
    }
  }

  const handleRemoveUser = () => {
    if (!selectedUserId) return
    removePortalUser.mutate(selectedUserId as MemberId, {
      onSuccess: () => {
        setSelectedUserId(null)
      },
    })
  }

  return (
    <UsersLayout
      hasActiveFilters={hasActiveFilters}
      filters={<UsersFiltersPanel filters={filters} onFiltersChange={setFilters} />}
      userList={
        <UsersList
          users={users}
          hasMore={!!hasMore}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          selectedUserId={selectedUserId}
          onSelectUser={setSelectedUserId}
          onLoadMore={handleLoadMore}
          filters={filters}
          onFiltersChange={setFilters}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
          total={usersData?.pages[0]?.total ?? 0}
        />
      }
      userDetail={
        <UserDetail
          user={selectedUser ?? null}
          isLoading={isLoadingUser}
          onClose={() => setSelectedUserId(null)}
          onRemoveUser={handleRemoveUser}
          isRemovePending={removePortalUser.isPending}
          currentMemberRole={currentMemberRole}
        />
      }
    />
  )
}
