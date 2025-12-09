'use client'

import { UsersLayout } from './users-layout'
import { UsersFiltersPanel } from './users-filters'
import { UsersList } from './users-list'
import { UserDetail } from './user-detail'
import { useUsersFilters } from './use-users-filters'
import {
  usePortalUsers,
  useUserDetail,
  useUpdateMemberRole,
  useRemoveMember,
  flattenUsers,
} from '@/lib/hooks/use-users-queries'
import type { PortalUserListResult } from '@quackback/domain'

interface UsersContainerProps {
  organizationId: string
  initialUsers: PortalUserListResult
  currentMemberRole: string
}

export function UsersContainer({
  organizationId,
  initialUsers,
  currentMemberRole,
}: UsersContainerProps) {
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
    organizationId,
    filters,
    initialData: initialUsers,
  })

  const users = flattenUsers(usersData)

  // Server state - Selected user detail
  const { data: selectedUser, isLoading: isLoadingUser } = useUserDetail({
    memberId: selectedUserId,
    organizationId,
  })

  // Mutations
  const updateRole = useUpdateMemberRole(organizationId)
  const removeMember = useRemoveMember(organizationId)

  // Handlers
  const handleLoadMore = () => {
    if (hasMore && !isLoadingMore) {
      fetchNextPage()
    }
  }

  const handleRoleChange = (newRole: string) => {
    if (!selectedUserId) return
    updateRole.mutate(
      { memberId: selectedUserId, role: newRole },
      {
        onSuccess: () => {
          // If role changed from 'user', clear selection as they'll disappear from list
          if (newRole !== 'user') {
            setSelectedUserId(null)
          }
        },
      }
    )
  }

  const handleRemoveUser = () => {
    if (!selectedUserId) return
    removeMember.mutate(selectedUserId, {
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
          onRoleChange={handleRoleChange}
          onRemoveUser={handleRemoveUser}
          isRoleChangePending={updateRole.isPending}
          isRemovePending={removeMember.isPending}
          currentMemberRole={currentMemberRole}
        />
      }
    />
  )
}
