import { useMemo, useState, type ReactNode } from 'react'
import { Link, useRouteContext } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HomeIcon } from '@heroicons/react/24/solid'
import { adminOverviewQueries } from '@/lib/client/queries/admin-overview'
import {
  overviewMetricGridClass,
  publishStatusLabel,
  type AdminEntity,
  type OverviewAttentionItem,
  type OverviewAttentionKind,
  type OverviewLink,
  type OverviewMetric,
  type OverviewMomentumItem,
  type OverviewPublishItem,
} from '@/lib/shared/admin-overview'
import { cn } from '@/lib/shared/utils'
import { EntityIcon } from '@/components/admin/entity-icon'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { Avatar } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function useWorkspaceHomeTitle(): string {
  const { settings } = useRouteContext({ from: '__root__' })
  const branding = (settings as { brandingData?: { name?: string } } | undefined)?.brandingData
  return branding?.name ?? settings?.name ?? 'Home'
}

type Filter = OverviewAttentionKind | 'all'

/**
 * One list, one supporting panel. Counts and the feed are workspace-wide;
 * the viewer's own items are sorted first server-side.
 */
export function OverviewDashboard({
  actions,
  banner,
}: {
  actions?: ReactNode
  banner?: ReactNode
}) {
  const overview = useQuery(adminOverviewQueries.get())
  const [filter, setFilter] = useState<Filter>('all')
  const data = overview.data

  const attention = useMemo(() => {
    const items = data?.attention ?? []
    if (filter === 'all') return items
    return items.filter((item) => item.kind === filter)
  }, [data?.attention, filter])

  const filters = useMemo(() => {
    const kinds: Array<{ id: Filter; label: string }> = [{ id: 'all', label: 'All' }]
    if (data?.sections.support.enabled) kinds.push({ id: 'support', label: 'Support' })
    if (data?.sections.feedback.enabled) kinds.push({ id: 'feedback', label: 'Feedback' })
    if (data?.sections.feedback.enabled || data?.sections.changelog.enabled) {
      kinds.push({ id: 'publishing', label: 'Publishing' })
    }
    return kinds
  }, [data?.sections])

  const hasAside = (data?.momentum.length ?? 0) > 0 || (data?.publishing.length ?? 0) > 0
  const asideError = data?.sections.changelog.error || data?.sections.helpCenter.error || null
  const feedError = data?.sections.support.error || data?.sections.feedback.error || null

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader icon={HomeIcon} title="Overview" size="large" action={actions} />

      {banner}

      {overview.isError ? (
        <Quiet>
          Couldn’t load the overview.{' '}
          <RetryButton onClick={() => void overview.refetch()}>Try again</RetryButton>
        </Quiet>
      ) : (
        <>
          <CountsStrip
            metrics={data?.metrics ?? []}
            loading={overview.isLoading}
            onFilter={(next) => {
              if (next !== 'articles') setFilter(next)
            }}
          />

          <div
            className={cn(
              'grid items-start gap-8',
              (hasAside || asideError) && 'lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]'
            )}
          >
            <section aria-label="Needs attention" className="min-w-0">
              {filters.length > 2 ? (
                <Tabs
                  value={filter}
                  onValueChange={(value) => setFilter(value as Filter)}
                  variant="line"
                  className="gap-0"
                >
                  <TabsList className="h-9">
                    {filters.map((item) => (
                      <TabsTrigger key={item.id} value={item.id} className="pb-2">
                        {item.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              ) : (
                <div className="border-b border-border" />
              )}

              {feedError ? (
                <Quiet>
                  {feedError}{' '}
                  <RetryButton onClick={() => void overview.refetch()}>Retry</RetryButton>
                </Quiet>
              ) : overview.isLoading ? (
                <RowsSkeleton rows={5} />
              ) : attention.length === 0 ? (
                <Quiet>You’re all caught up.</Quiet>
              ) : (
                <div className="divide-y divide-border">
                  {attention.map((item) => (
                    <AttentionRow key={item.id} item={item} />
                  ))}
                </div>
              )}
            </section>

            {overview.isLoading ? (
              <Skeleton className="hidden h-40 rounded-xl lg:block" />
            ) : asideError ? (
              <Aside>
                <Quiet>
                  {asideError}{' '}
                  <RetryButton onClick={() => void overview.refetch()}>Retry</RetryButton>
                </Quiet>
              </Aside>
            ) : hasAside ? (
              <Aside>
                <AsideGroup title="Momentum" items={data!.momentum}>
                  {(item) => <MomentumRow key={item.postId} item={item} />}
                </AsideGroup>
                <AsideGroup title="Publishing" items={data!.publishing}>
                  {(item) => <PublishRow key={item.id} item={item} />}
                </AsideGroup>
              </Aside>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

function CountsStrip({
  metrics,
  loading,
  onFilter,
}: {
  metrics: OverviewMetric[]
  loading: boolean
  onFilter: (filter: OverviewMetric['filter']) => void
}) {
  if (loading) return <Skeleton className="h-16 w-full rounded-none" />
  if (metrics.length === 0) return null
  return (
    <div
      className={cn(
        'grid gap-px border-y border-border bg-border/60',
        overviewMetricGridClass(metrics.length)
      )}
    >
      {metrics.map((metric) => (
        <OverviewNavLink
          key={metric.key}
          link={metric.link}
          onClick={() => onFilter(metric.filter)}
          className="flex min-w-0 items-baseline gap-2 bg-background px-3 py-3 transition-colors hover:bg-muted/40 sm:px-4"
        >
          <span className="text-xl font-semibold leading-none tabular-nums tracking-tight sm:text-2xl">
            {metric.count.toLocaleString()}
          </span>
          <span className="truncate text-sm text-muted-foreground">{metric.label}</span>
        </OverviewNavLink>
      ))}
    </div>
  )
}

function OverviewEntityRow({
  link,
  entity,
  title,
  badge,
  badgeColor,
  meta,
  trailing,
}: {
  link: OverviewLink
  entity: AdminEntity
  title: string
  badge?: string | null
  badgeColor?: string | null
  meta?: string | null
  trailing?: ReactNode
}) {
  return (
    <OverviewNavLink
      link={link}
      className="flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/40 sm:px-4"
    >
      <EntityIcon entity={entity} className="self-start mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-medium line-clamp-2 sm:line-clamp-1">
          {title}
        </span>
        {badge || meta ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {badge ? (
              <StatusBadge name={badge} color={badgeColor} className="shrink-0 text-xs" />
            ) : null}
            {badge && meta ? <span aria-hidden="true">·</span> : null}
            {meta ? <span className="min-w-0 truncate">{meta}</span> : null}
          </span>
        ) : null}
      </span>
      {trailing ? <span className="flex shrink-0 items-center gap-2">{trailing}</span> : null}
    </OverviewNavLink>
  )
}

function AttentionRow({ item }: { item: OverviewAttentionItem }) {
  return (
    <OverviewEntityRow
      link={item.link}
      entity={item.entity}
      title={item.title}
      badge={item.reason}
      badgeColor={item.reasonColor}
      meta={item.meta}
      trailing={
        item.ownerName ? (
          <Avatar name={item.ownerName} className="hidden size-6 text-[11px] sm:flex" />
        ) : null
      }
    />
  )
}

function MomentumRow({ item }: { item: OverviewMomentumItem }) {
  return (
    <OverviewEntityRow
      link={item.link}
      entity={item.entity}
      title={item.title}
      trailing={
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          +{item.votesLast7d}
        </span>
      }
    />
  )
}

function PublishRow({ item }: { item: OverviewPublishItem }) {
  return (
    <OverviewEntityRow
      link={item.link}
      entity={item.entity}
      title={item.title}
      badge={publishStatusLabel(item.status)}
      meta={item.meta}
    />
  )
}

function Aside({ children }: { children: ReactNode }) {
  return (
    <aside className="min-w-0 divide-y divide-border rounded-xl border border-border">
      {children}
    </aside>
  )
}

function AsideGroup<T>({
  title,
  items,
  children,
}: {
  title: string
  items: T[]
  children: (item: T) => ReactNode
}) {
  if (items.length === 0) return null
  return (
    <div className="py-1">
      <h2 className="px-3 pb-1 pt-2.5 text-sm font-semibold sm:px-4">{title}</h2>
      <div>{items.map(children)}</div>
    </div>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="px-3 py-8 text-center text-sm text-muted-foreground sm:px-4">{children}</p>
}

function RetryButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="underline" onClick={onClick}>
      {children}
    </button>
  )
}

function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 py-3">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-10 w-full rounded-md" />
      ))}
    </div>
  )
}

function OverviewNavLink({
  link,
  className,
  children,
  onClick,
}: {
  link: OverviewLink
  className?: string
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <Link
      to={link.to}
      search={link.search}
      params={link.params}
      onClick={onClick}
      className={cn('text-inherit no-underline', className)}
    >
      {children}
    </Link>
  )
}
