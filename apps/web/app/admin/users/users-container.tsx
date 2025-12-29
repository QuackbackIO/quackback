'use client'

import { UsersLayout } from './users-layout'
import { UsersFiltersPanel } from './users-filters'
import { UsersList } from './users-list'
import { UserDetail } from './user-detail'
import { useUsersFilters } from './use-users-filters'
import {
  usePortalUsers,
  useUserDetail,
  useRemovePortalUser,
  flattenUsers,
} from '@/lib/hooks/use-users-queries'
import type { PortalUserListResult } from '@/lib/users'
import type { MemberId } from '@quackback/ids'

interface UsersContainerProps {
  initialUsers: PortalUserListResult
  currentMemberRole: string
}

export function UsersContainer({ initialUsers, currentMemberRole }: UsersContainerProps) {
  // URL-based filter state
  const {
    filters,
    setFilters,
    clearFilters,
    selectedUserId,
    setSelectedUserId: setSelectedUserIdAsync,
    hasActiveFilters,
  } = useUsersFilters()

  // Simple wrapper - nuqs returns Promise but we don't need to await
  const setSelectedUserId = (id: string | null) => void setSelectedUserIdAsync(id)

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
      filters={
        <UsersFiltersPanel
          filters={filters}
          onFiltersChange={setFilters}
          onClearFilters={clearFilters}
        />
      }
      userList={
        <UsersList
          users={users}
          hasMore={!!hasMore}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          selectedUserId={selectedUserId}
          onSelectUser={setSelectedUserId}
          onLoadMore={handleLoadMore}
          sort={filters.sort}
          onSortChange={(sort) => setFilters({ sort })}
          search={filters.search}
          onSearchChange={(search) => setFilters({ search })}
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
