import { useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { analyticsQueries } from '@/lib/client/queries/analytics'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { UsersLayout } from '@/components/admin/users/users-layout'
import { UsersSegmentNav } from '@/components/admin/users/users-segment-nav'
import { UsersList } from '@/components/admin/users/users-list'
import { UserDetail } from '@/components/admin/users/user-detail'
import { CompaniesView } from '@/components/admin/users/companies-view'
import { CompanyDetail } from '@/components/admin/users/company-detail'
import { InvitationsView } from '@/components/admin/users/invitations-view'
import { useUsersFilters } from '@/components/admin/users/use-users-filters'
import { usePortalInvites } from '@/components/admin/users/use-portal-invites'
import { Route as UsersRoute } from '@/routes/admin/users'
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
import { parseCompanyFilterParts } from '@/lib/shared/company-filters'
import { listCompaniesFn } from '@/lib/server/functions/companies'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import type { PortalUserListResultView } from '@/lib/shared/types'
import type { PrincipalId, SegmentId } from '@quackback/ids'
import type { SegmentCondition } from '@/lib/shared/db-types'

interface UsersContainerProps {
  initialUsers: PortalUserListResultView
  currentMemberRole: string
}

export function UsersContainer({ initialUsers, currentMemberRole }: UsersContainerProps) {
  // URL-based filter state
  const {
    filters,
    setFilters,
    clearFilters,
    selectedUserId,
    setSelectedUserId,
    selectedCompanyId,
    setSelectedCompanyId,
    hasActiveFilters,
  } = useUsersFilters()

  // The `?invites=<status>` param flips the entire main pane to the
  // Invitations view. Reading it via the route's typed search keeps
  // navigation in sync with the URL without an effect.
  const search = UsersRoute.useSearch()
  const invitesStatus = search.invites
  const inInvitesMode = !!invitesStatus

  // Total pending-invite count powers the badge on the segment-nav entry.
  // Pulled at the container level so we don't have to drill into the
  // invitations view to read it. Gated on admin role — the underlying
  // server fn requires admin and would 403 on every /admin/users mount
  // for `member` / `user` roles otherwise.
  const { pendingCount: invitesPendingCount } = usePortalInvites({
    enabled: currentMemberRole === 'admin',
  })

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

  // Lifecycle view counts (always unfiltered, for the nav labels)
  const { data: totalUserCount } = useTotalUserCount()
  const { data: totalLeadCount } = useTotalUserCount('leads')
  const inLeadsMode = filters.lifecycle === 'leads'
  const inCompaniesMode = filters.lifecycle === 'companies'

  // Companies directory (the Companies lifecycle tab). Fetched only for team
  // roles — the server fn is gated on company.view, which both presets hold.
  const companyFilterParts = parseCompanyFilterParts(filters.companyAttrs)
  const { data: companies, isLoading: isLoadingCompanies } = useQuery({
    queryKey: [
      'admin',
      'companies',
      { search: filters.search, companyAttrs: filters.companyAttrs },
    ],
    queryFn: () =>
      listCompaniesFn({
        data: {
          search: filters.search,
          plan: companyFilterParts.plan,
          mrr: companyFilterParts.mrr,
          fields: companyFilterParts.fields,
          attrs: companyFilterParts.attrs,
        },
      }),
    enabled: currentMemberRole === 'admin' || currentMemberRole === 'member',
    staleTime: 30_000,
  })
  // Unfiltered total for the nav badge (cheap: companies lists are small).
  const { data: allCompanies } = useQuery({
    queryKey: ['admin', 'companies'],
    queryFn: () => listCompaniesFn(),
    enabled: currentMemberRole === 'admin' || currentMemberRole === 'member',
    staleTime: 60_000,
  })

  // Top-of-funnel context: 30d unique visitors from the analytics rollup.
  // Visitors are not directory rows (no principal yet), so this is a
  // non-navigating count that links to the analytics Visitors section.
  const { settings } = useRouteContext({ from: '__root__' })
  const visitorAnalyticsOn =
    (settings?.featureFlags as FeatureFlags | undefined)?.visitorAnalytics ?? false
  const { data: visitorAnalyticsData } = useQuery({
    ...analyticsQueries.visitors('30d', 'all'),
    enabled: visitorAnalyticsOn,
  })
  const visitorCount =
    visitorAnalyticsData && visitorAnalyticsData.enabled
      ? visitorAnalyticsData.uniqueVisitors.current
      : null

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
    // Segments are populated by identified users, so selecting one always
    // returns to the users view (leads can't be segment members).
    if (shiftKey) {
      // Shift-click: toggle the segment in/out of multi-selection
      const isSelected = currentIds.includes(segmentId)
      const newIds = isSelected
        ? currentIds.filter((id) => id !== segmentId)
        : [...currentIds, segmentId]
      setFilters({ segmentIds: newIds.length > 0 ? newIds : undefined, lifecycle: undefined })
    } else {
      // Normal click: replace selection with just this segment (or deselect if already sole selection)
      const isSoleSelection = currentIds.length === 1 && currentIds[0] === segmentId
      setFilters({ segmentIds: isSoleSelection ? undefined : [segmentId], lifecycle: undefined })
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
            inInvitesMode={inInvitesMode}
            invitesPendingCount={invitesPendingCount}
            inLeadsMode={inLeadsMode}
            totalLeadCount={totalLeadCount}
            inCompaniesMode={inCompaniesMode}
            totalCompanyCount={allCompanies?.length}
            visitorCount={visitorCount}
          />
        }
      >
        {inInvitesMode ? (
          <InvitationsView status={invitesStatus ?? 'pending'} />
        ) : inCompaniesMode ? (
          selectedCompanyId ? (
            <CompanyDetail
              companyId={selectedCompanyId}
              onClose={() => setSelectedCompanyId(null)}
              canManage={currentMemberRole === 'admin'}
            />
          ) : (
            <CompaniesView
              companies={companies}
              isLoading={isLoadingCompanies}
              search={filters.search}
              onSearchChange={(value) => setFilters({ search: value })}
              companyAttrs={filters.companyAttrs}
              onCompanyAttrsChange={(encoded) => setFilters({ companyAttrs: encoded })}
              onSelectCompany={setSelectedCompanyId}
              canManage={currentMemberRole === 'admin'}
            />
          )
        ) : selectedUserId ? (
          <UserDetail
            user={selectedUser ?? null}
            isLoading={isLoadingUser}
            onClose={() => setSelectedUserId(null)}
            onRemoveUser={handleRemoveUser}
            isRemovePending={removePortalUser.isPending}
            currentMemberRole={currentMemberRole}
          />
        ) : (
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
        )}
      </UsersLayout>

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
