import { useState } from 'react'
import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query'
import { UsersLayout } from '@/components/admin/users/users-layout'
import { UsersSegmentNav } from '@/components/admin/users/users-segment-nav'
import { UsersList } from '@/components/admin/users/users-list'
import { UserDetail } from '@/components/admin/users/user-detail'
import { CompaniesView } from '@/components/admin/users/companies-view'
import { CompanyDetail } from '@/components/admin/users/company-detail'
import { InvitationsView } from '@/components/admin/users/invitations-view'
import { NewPersonDialog } from '@/components/admin/users/new-person-dialog'
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
import { useCompanyAttributes } from '@/lib/client/hooks/use-company-attributes-queries'
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
import { listCompaniesPageFn, countCompaniesFn } from '@/lib/server/functions/companies'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import type { PrincipalId, SegmentId } from '@quackback/ids'
import type { SegmentCondition } from '@/lib/shared/db-types'

interface UsersContainerProps {
  currentMemberRole: string
}

export function UsersContainer({ currentMemberRole }: UsersContainerProps) {
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

  // Server state - Users list (with infinite query for pagination). The route
  // loader prefetches the default/unfiltered dataset into this same infinite
  // cache (QC-1: one shared query definition), so the first paint reads warm
  // data and mutations that invalidate usersKeys reach what the list renders.
  const {
    data: usersData,
    isLoading,
    isFetchingNextPage: isLoadingMore,
    hasNextPage: hasMore,
    fetchNextPage,
  } = usePortalUsers({ filters })

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
  const companiesEnabled = currentMemberRole === 'admin' || currentMemberRole === 'member'
  // Keyset-paginated companies list (capped at 5 pages, like the People list),
  // fetched a page at a time instead of hauling the whole directory at once.
  const companyFilterData = {
    search: filters.search,
    plan: companyFilterParts.plan,
    mrr: companyFilterParts.mrr,
    fields: companyFilterParts.fields,
    attrs: companyFilterParts.attrs,
  }
  const {
    data: companyPages,
    isLoading: isLoadingCompanies,
    isFetchingNextPage: isLoadingMoreCompanies,
    hasNextPage: hasMoreCompanies,
    fetchNextPage: fetchMoreCompanies,
  } = useInfiniteQuery({
    queryKey: [
      'admin',
      'companies',
      { search: filters.search, companyAttrs: filters.companyAttrs },
    ],
    queryFn: ({ pageParam }) =>
      listCompaniesPageFn({
        data: { ...companyFilterData, cursor: pageParam ?? undefined },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    maxPages: 5,
    enabled: companiesEnabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
  const companies = companyPages?.pages.flatMap((p) => p.items)
  // Unfiltered total for the nav badge — a cheap dedicated count query rather
  // than a second full-list fetch.
  const { data: companyCount } = useQuery({
    queryKey: ['admin', 'companies', 'count'],
    queryFn: () => countCompaniesFn(),
    enabled: companiesEnabled,
    staleTime: 60_000,
  })

  // Segments data
  const { data: segments, isLoading: isLoadingSegments } = useSegments()
  const { data: customAttributes } = useUserAttributes()
  const { data: companyAttributes } = useCompanyAttributes()

  // Segment mutations
  const createSegment = useCreateSegment()
  const updateSegment = useUpdateSegment()
  const deleteSegment = useDeleteSegment()
  const evaluateSegment = useEvaluateSegment()

  // User mutations
  const removePortalUser = useRemovePortalUser()

  // Segment dialog state
  const [createOpen, setCreateOpen] = useState(false)
  // "New person" (ad-hoc contact) dialog state
  const [newPersonOpen, setNewPersonOpen] = useState(false)
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
                serializeCondition(c, customAttributes, companyAttributes)
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
                  serializeCondition(c, customAttributes, companyAttributes)
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
            totalCompanyCount={companyCount}
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
              hasMore={!!hasMoreCompanies}
              isLoadingMore={isLoadingMoreCompanies}
              onLoadMore={() => fetchMoreCompanies()}
              totalCount={companyCount}
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
            onNewPerson={currentMemberRole === 'admin' ? () => setNewPersonOpen(true) : undefined}
            canManage={currentMemberRole === 'admin'}
          />
        )}
      </UsersLayout>

      {/* New person (ad-hoc contact) dialog */}
      <NewPersonDialog
        open={newPersonOpen}
        onOpenChange={setNewPersonOpen}
        onViewPerson={(principalId) => setSelectedUserId(principalId)}
      />

      {/* Create dialog */}
      <SegmentFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreateSegment}
        isPending={createSegment.isPending}
        customAttributes={customAttributes}
        companyAttributes={companyAttributes}
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
                        deserializeCondition(c, customAttributes, companyAttributes)
                      ) as unknown as RuleCondition[],
                    }
                  : { match: 'all', conditions: [] },
              }
            : undefined
        }
        onSubmit={handleUpdateSegment}
        isPending={updateSegment.isPending}
        customAttributes={customAttributes}
        companyAttributes={companyAttributes}
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
