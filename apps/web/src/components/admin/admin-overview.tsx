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
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { Avatar } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function useWorkspaceHomeTitle(): string {
  const { settings } = useRouteContext({ from: '__root__' })
  const branding = (settings as { brandingData?: { name?: string } } | undefined)?.brandingData
  return branding?.name ?? settings?.name ?? 'Home'
}

type Filter = OverviewAttentionKind | 'all'

/**
 * One work list, then a card per module on the rail. Counts and the feed are
 * workspace-wide; the viewer's own items are sorted first server-side.
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
    return kinds
  }, [data?.sections])

  const momentum = data?.momentum ?? []
  const changelog = data?.changelog ?? []
  const helpCenter = data?.helpCenter ?? []
  const changelogError = data?.sections.changelog.error ?? null
  const helpError = data?.sections.helpCenter.error ?? null
  const hasAside =
    momentum.length > 0 ||
    changelog.length > 0 ||
    helpCenter.length > 0 ||
    Boolean(changelogError) ||
    Boolean(helpError)
  const feedError = data?.sections.support.error || data?.sections.feedback.error || null

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader icon={HomeIcon} title="Overview" size="large" action={actions} />

      {banner}

      {overview.isError ? (
        <SettingsCard contentClassName="p-0 sm:p-0">
          <Quiet>
            Couldn’t load the overview.{' '}
            <RetryButton onClick={() => void overview.refetch()}>Try again</RetryButton>
          </Quiet>
        </SettingsCard>
      ) : (
        <>
          <CountsCard
            metrics={data?.metrics ?? []}
            loading={overview.isLoading}
            onFilter={(next) => {
              if (next !== 'helpCenter') setFilter(next)
            }}
          />

          <div
            className={cn(
              'grid items-start gap-6',
              hasAside && 'lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]'
            )}
          >
            <SettingsCard contentClassName="p-0 sm:p-0">
              {filters.length > 2 ? (
                <Tabs
                  value={filter}
                  onValueChange={(value) => setFilter(value as Filter)}
                  variant="line"
                  className="gap-0 px-4"
                >
                  <TabsList className="h-9">
                    {filters.map((item) => (
                      <TabsTrigger key={item.id} value={item.id} className="pb-2">
                        {item.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              ) : null}

              {overview.isLoading ? (
                <RowsSkeleton rows={5} />
              ) : (
                <>
                  {feedError && attention.length > 0 ? (
                    <p className="border-b border-border px-3 py-2.5 text-sm text-muted-foreground sm:px-4">
                      {feedError}{' '}
                      <RetryButton onClick={() => void overview.refetch()}>Retry</RetryButton>
                    </p>
                  ) : null}
                  {attention.length > 0 ? (
                    <div className="divide-y divide-border">
                      {attention.map((item) => (
                        <AttentionRow key={item.id} item={item} />
                      ))}
                    </div>
                  ) : feedError ? (
                    <Quiet>
                      {feedError}{' '}
                      <RetryButton onClick={() => void overview.refetch()}>Retry</RetryButton>
                    </Quiet>
                  ) : (
                    <Quiet>You’re all caught up.</Quiet>
                  )}
                </>
              )}
            </SettingsCard>

            {overview.isLoading ? (
              <Skeleton className="hidden h-40 rounded-xl lg:block" />
            ) : hasAside ? (
              <aside className="min-w-0 space-y-6">
                <ModuleCard title="Feedback" items={momentum}>
                  {(item) => <MomentumRow key={item.postId} item={item} />}
                </ModuleCard>
                <ModuleCard
                  title="Changelog"
                  items={changelog}
                  error={changelogError}
                  onRetry={() => void overview.refetch()}
                >
                  {(item) => <DeskRow key={item.id} item={item} />}
                </ModuleCard>
                <ModuleCard
                  title="Help Center"
                  items={helpCenter}
                  error={helpError}
                  onRetry={() => void overview.refetch()}
                >
                  {(item) => <DeskRow key={item.id} item={item} />}
                </ModuleCard>
              </aside>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

function CountsCard({
  metrics,
  loading,
  onFilter,
}: {
  metrics: OverviewMetric[]
  loading: boolean
  onFilter: (filter: OverviewMetric['filter']) => void
}) {
  if (loading) return <Skeleton className="h-24 w-full rounded-xl" />
  if (metrics.length === 0) return null
  return (
    <Card className="overflow-hidden py-0 gap-0">
      <div className={cn('grid gap-px bg-border/50', overviewMetricGridClass(metrics.length))}>
        {metrics.map((metric) => (
          <OverviewNavLink
            key={metric.key}
            link={metric.link}
            onClick={() => onFilter(metric.filter)}
            className="flex min-w-0 items-center gap-3 bg-card px-3 py-3.5 transition-colors hover:bg-muted/40 sm:gap-4 sm:px-5 sm:py-5"
          >
            <span className="shrink-0 text-3xl font-semibold leading-none tabular-nums tracking-tight sm:text-4xl">
              {metric.count.toLocaleString()}
            </span>
            <span className="min-w-0 text-sm leading-snug text-muted-foreground">
              <span className="block">{metric.label}</span>
              <span className="block">{metric.detail}</span>
            </span>
          </OverviewNavLink>
        ))}
      </div>
    </Card>
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
      <EntityIcon entity={entity} className="mt-0.5 self-start" />
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

function DeskRow({ item }: { item: OverviewPublishItem }) {
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

function ModuleCard<T>({
  title,
  items,
  error,
  onRetry,
  children,
}: {
  title: string
  items: T[]
  error?: string | null
  onRetry?: () => void
  children: (item: T) => ReactNode
}) {
  if (error) {
    return (
      <SettingsCard title={title} contentClassName="p-0 sm:p-0">
        <Quiet>
          {error} {onRetry ? <RetryButton onClick={onRetry}>Retry</RetryButton> : null}
        </Quiet>
      </SettingsCard>
    )
  }
  if (items.length === 0) return null
  return (
    <SettingsCard title={title} contentClassName="p-0 sm:p-0">
      <div className="divide-y divide-border">{items.map(children)}</div>
    </SettingsCard>
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
    <div className="space-y-3 px-4 py-3">
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
