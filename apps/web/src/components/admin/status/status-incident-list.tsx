import { useCallback, useMemo, useState, startTransition } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { EllipsisHorizontalIcon, TrashIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/shared/spinner'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { AdminListHeader } from '@/components/admin/admin-list-header'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TimeAgo } from '@/components/ui/time-ago'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { useDebouncedSearch } from '@/lib/client/hooks/use-debounced-search'
import { Route } from '@/routes/admin/status'
import { statusIncidentQueries, type StatusIncidentAdmin } from '@/lib/client/queries/status'
import { useDeleteStatusIncident } from '@/lib/client/mutations/status'
import { CreateStatusIncidentDialog } from './status-incident-modal'
import {
  IMPACT_COLORS,
  IMPACT_LABELS,
  LIFECYCLE_COLORS,
  LIFECYCLE_LABELS,
} from './status-admin-colors'

type SortMode = 'newest' | 'impact'

const IMPACT_RANK: Record<string, number> = {
  critical: 3,
  major: 2,
  minor: 1,
  maintenance: 0,
  none: 0,
}

interface StatusIncidentListProps {
  kind?: 'incident' | 'maintenance'
  state: 'active' | 'all'
  emptyMessage: string
}

export function StatusIncidentList({ kind, state, emptyMessage }: StatusIncidentListProps) {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const [sort, setSort] = useState<SortMode>('newest')
  const [deleteTarget, setDeleteTarget] = useState<StatusIncidentAdmin | null>(null)
  const deleteMutation = useDeleteStatusIncident()

  const { value: searchValue, setValue: setSearchValue } = useDebouncedSearch({
    externalValue: undefined,
    onChange: () => {},
  })

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    statusIncidentQueries.list({ kind, state })
  )

  const loadMoreRef = useInfiniteScroll({
    hasMore: !!hasNextPage,
    isFetching: isLoading || isFetchingNextPage,
    onLoadMore: fetchNextPage,
    rootMargin: '0px',
    threshold: 0.1,
  })

  const allItems = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data])

  const items = useMemo(() => {
    let list = allItems
    if (searchValue) {
      const q = searchValue.toLowerCase()
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.updates.some((u) => u.body.toLowerCase().includes(q))
      )
    }
    if (sort === 'impact') {
      list = [...list].sort((a, b) => (IMPACT_RANK[b.impact] ?? 0) - (IMPACT_RANK[a.impact] ?? 0))
    }
    return list
  }, [allItems, searchValue, sort])

  const handleOpen = useCallback(
    (id: string) => {
      startTransition(() => {
        navigate({ to: '/admin/status', search: { ...search, incident: id } })
      })
    },
    [navigate, search]
  )

  const confirmDelete = () => {
    if (!deleteTarget) return
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    })
  }

  return (
    <>
      <div className="max-w-5xl mx-auto w-full flex flex-col flex-1 min-h-0">
        <AdminListHeader
          searchValue={searchValue}
          onSearchChange={setSearchValue}
          searchPlaceholder="Search incidents…"
          sortOptions={[
            { value: 'newest', label: 'Newest' },
            { value: 'impact', label: 'Impact' },
          ]}
          activeSort={sort}
          onSortChange={(v) => setSort(v as SortMode)}
          action={
            <div className="flex items-center gap-2 ml-auto">
              <CreateStatusIncidentDialog kind="maintenance" />
              <CreateStatusIncidentDialog kind="incident" />
            </div>
          }
        />

        {isLoading ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/50 bg-card p-4">
                <Skeleton className="h-4 w-2/3 mb-2" />
                <Skeleton className="h-3 w-full mb-2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={ExclamationTriangleIcon}
            title={searchValue ? 'No incidents match your search' : emptyMessage}
            className="h-48"
          />
        ) : (
          <div className="p-3">
            <div className="rounded-xl overflow-hidden shadow-sm divide-y divide-border/50 bg-card border border-border/50">
              {items.map((incident) => (
                <StatusIncidentRow
                  key={incident.id}
                  incident={incident}
                  onOpen={handleOpen}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          </div>
        )}

        {hasNextPage && (
          <div ref={loadMoreRef} className="px-3 pb-3 flex justify-center">
            {isFetchingNextPage && <Spinner />}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete incident?"
        description="This action cannot be undone. The incident and all of its updates will be permanently deleted."
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={confirmDelete}
      />
    </>
  )
}

function StatusIncidentRow({
  incident,
  onOpen,
  onDelete,
}: {
  incident: StatusIncidentAdmin
  onOpen: (id: string) => void
  onDelete: (incident: StatusIncidentAdmin) => void
}) {
  const lastUpdate = incident.updates[incident.updates.length - 1]
  const preview = lastUpdate?.body ?? ''
  const lifecycle = incident.status as keyof typeof LIFECYCLE_LABELS
  const visibleComponents = incident.affectedComponents.slice(0, 2)
  const overflow = incident.affectedComponents.length - visibleComponents.length

  return (
    <div
      className="group relative flex items-start gap-3 p-4 hover:bg-muted/20 transition-colors cursor-pointer"
      onClick={() => onOpen(incident.id)}
    >
      <span
        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: IMPACT_COLORS[incident.impact] }}
        aria-hidden="true"
      />

      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-base text-foreground line-clamp-1">{incident.title}</h3>
        {preview && <p className="text-sm text-muted-foreground/60 line-clamp-1 mt-1">{preview}</p>}

        <div className="flex items-center flex-wrap gap-2 text-xs text-muted-foreground mt-2.5">
          <span
            className="font-semibold uppercase tracking-wide text-[11px]"
            style={{ color: LIFECYCLE_COLORS[lifecycle] }}
          >
            {LIFECYCLE_LABELS[lifecycle]}
          </span>
          <span>·</span>
          <Badge variant="outline" className="h-5">
            {IMPACT_LABELS[incident.impact]}
          </Badge>
          {visibleComponents.map((c) => (
            <span
              key={c.componentId}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5"
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: IMPACT_COLORS[incident.impact] }}
              />
              {c.name}
            </span>
          ))}
          {overflow > 0 && <span>+{overflow}</span>}
          <span>·</span>
          <span>
            {incident.updates.length} update{incident.updates.length === 1 ? '' : 's'}
          </span>
          <span>·</span>
          <TimeAgo date={lastUpdate?.createdAt ?? incident.startedAt} />
        </div>
      </div>

      <div
        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted/50">
              <EllipsisHorizontalIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => onDelete(incident)}
              className="text-destructive focus:text-destructive"
            >
              <TrashIcon className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
