import { useState } from 'react'
import { UsersLayout } from '@/components/admin/users/users-layout'
import { UsersSegmentNav } from '@/components/admin/users/users-segment-nav'
import { UsersList } from '@/components/admin/users/users-list'
import { UserDetail } from '@/components/admin/users/user-detail'
import { useUsersFilters } from '@/components/admin/users/use-users-filters'
import {
  usePortalUsers,
  useUserDetail,
  useTotalUserCount,
  flattenUsers,
} from '@/lib/client/hooks/use-users-queries'
import { useRemovePortalUser } from '@/lib/client/mutations'
import { useSegments, type SegmentListItem } from '@/lib/client/hooks/use-segments-queries'
import { useUserAttributes } from '@/lib/client/hooks/use-user-attributes-queries'
import {
  useCreateSegment,
  useUpdateSegment,
  useDeleteSegment,
  useEvaluateSegment,
} from '@/lib/client/mutations'
import { SegmentFormDialog } from '@/components/admin/segments/segment-form'
import type { SegmentFormValues, RuleCondition } from '@/components/admin/segments/segment-form'
import {
  getAutoColor,
  serializeCondition,
  deserializeCondition,
} from '@/components/admin/segments/segment-utils'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import type { PortalUserListResultView } from '@/lib/server/domains/users'
import type { PrincipalId, SegmentId } from '@quackback/ids'
import type { SegmentCondition } from '@/lib/shared/db-types'

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
    principalId: selectedUserId as PrincipalId | null,
  })

  // Total user count (always unfiltered, for "All users" label)
  const { data: totalUserCount } = useTotalUserCount()

  // Segments data
  const { data: segments, isLoading: isLoadingSegments } = useSegments()
  const { data: customAttributes } = useUserAttributes()

  // Segment mutations
  const createSegment = useCreateSegment()
  const updateSegment = useUpdateSegment()
  const deleteSegment = useDeleteSegment()
  const evaluateSegment = useEvaluateSegment()

  // User mutations
  const removePortalUser = useRemovePortalUser()

  // Segment dialog state
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<SegmentListItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SegmentListItem | null>(null)
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null)

  // Handlers
  const handleLoadMore = () => {
    if (hasMore && !isLoadingMore) {
      fetchNextPage()
    }
  }

  const handleRemoveUser = () => {
    if (!selectedUserId) return
    removePortalUser.mutate(selectedUserId as PrincipalId, {
      onSuccess: () => {
        setSelectedUserId(null)
      },
    })
  }

  const handleSelectSegment = (segmentId: string, shiftKey: boolean) => {
    const currentIds = filters.segmentIds ?? []
    if (shiftKey) {
      // Shift-click: toggle the segment in/out of multi-selection
      const isSelected = currentIds.includes(segmentId)
      const newIds = isSelected
        ? currentIds.filter((id) => id !== segmentId)
        : [...currentIds, segmentId]
      setFilters({ segmentIds: newIds.length > 0 ? newIds : undefined })
    } else {
      // Normal click: replace selection with just this segment (or deselect if already sole selection)
      const isSoleSelection = currentIds.length === 1 && currentIds[0] === segmentId
      setFilters({ segmentIds: isSoleSelection ? undefined : [segmentId] })
    }
  }

  const handleClearSegments = () => {
    setFilters({ segmentIds: undefined })
  }

  const handleCreateSegment = async (values: SegmentFormValues) => {
    const segmentIndex = segments?.length ?? 0
    await createSegment.mutateAsync({
      name: values.name,
      description: values.description || undefined,
      type: values.type,
      color: getAutoColor(segmentIndex),
      rules:
        values.type === 'dynamic' && values.rules.conditions.length > 0
          ? {
              match: values.rules.match,
              conditions: values.rules.conditions.map((c) =>
                serializeCondition(c, customAttributes)
              ),
            }
          : undefined,
      // Always auto-evaluate hourly for dynamic segments
      evaluationSchedule:
        values.type === 'dynamic' ? { enabled: true, pattern: '0 * * * *' } : undefined,
    })
    setCreateOpen(false)
  }

  const handleUpdateSegment = async (values: SegmentFormValues) => {
    if (!editTarget) return
    await updateSegment.mutateAsync({
      segmentId: editTarget.id as SegmentId,
      name: values.name,
      description: values.description || null,
      rules:
        editTarget.type === 'dynamic'
          ? values.rules.conditions.length > 0
            ? {
                match: values.rules.match,
                conditions: values.rules.conditions.map((c) =>
                  serializeCondition(c, customAttributes)
                ),
              }
            : null
          : undefined,
      // Always auto-evaluate hourly for dynamic segments
      evaluationSchedule:
        editTarget.type === 'dynamic' ? { enabled: true, pattern: '0 * * * *' } : undefined,
    })
    setEditTarget(null)
  }

  const handleDeleteSegment = async () => {
    if (!deleteTarget) return
    await deleteSegment.mutateAsync(deleteTarget.id as SegmentId)
    // Remove from selection if it was selected
    const currentIds = filters.segmentIds ?? []
    if (currentIds.includes(deleteTarget.id)) {
      const newIds = currentIds.filter((id) => id !== deleteTarget.id)
      setFilters({ segmentIds: newIds.length > 0 ? newIds : undefined })
    }
    setDeleteTarget(null)
  }

  const handleEvaluateSegment = async (segmentId: string) => {
    setEvaluatingId(segmentId)
    try {
      await evaluateSegment.mutateAsync(segmentId as SegmentId)
    } finally {
      setEvaluatingId(null)
    }
  }

  return (
    <>
      <UsersLayout
        segmentNav={
          <UsersSegmentNav
            segments={segments}
            isLoading={isLoadingSegments}
            selectedSegmentIds={filters.segmentIds ?? []}
            onSelectSegment={handleSelectSegment}
            onClearSegments={handleClearSegments}
            totalUserCount={totalUserCount ?? 0}
            onCreateSegment={() => setCreateOpen(true)}
            onEditSegment={setEditTarget}
            onDeleteSegment={setDeleteTarget}
            onEvaluateSegment={handleEvaluateSegment}
            isEvaluating={evaluatingId}
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
            filters={filters}
            onFiltersChange={setFilters}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
            total={usersData?.pages[0]?.total ?? 0}
            segments={segments}
            selectedSegmentIds={filters.segmentIds ?? []}
            onSelectSegment={handleSelectSegment}
            onClearSegments={handleClearSegments}
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

      {/* Create dialog */}
      <SegmentFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreateSegment}
        isPending={createSegment.isPending}
        customAttributes={customAttributes}
      />

      {/* Edit dialog */}
      <SegmentFormDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        initialValues={
          editTarget
            ? {
                id: editTarget.id as SegmentId,
                name: editTarget.name,
                description: editTarget.description ?? '',
                type: editTarget.type as 'manual' | 'dynamic',
                rules: editTarget.rules
                  ? {
                      match: editTarget.rules.match,
                      conditions: editTarget.rules.conditions.map((c: SegmentCondition) =>
                        deserializeCondition(c, customAttributes)
                      ) as unknown as RuleCondition[],
                    }
                  : { match: 'all', conditions: [] },
              }
            : undefined
        }
        onSubmit={handleUpdateSegment}
        isPending={updateSegment.isPending}
        customAttributes={customAttributes}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="This will permanently delete the segment and remove all user memberships. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteSegment.isPending}
        onConfirm={handleDeleteSegment}
      />
    </>
  )
}
