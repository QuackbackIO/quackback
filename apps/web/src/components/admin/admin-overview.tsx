import { useMemo, useState, type ReactNode } from 'react'
import { Link, useRouteContext } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChartBarIcon, HomeIcon } from '@heroicons/react/24/solid'
import { adminOverviewQueries } from '@/lib/client/queries/admin-overview'
import {
  overviewMetricGridClass,
  publishStatusLabel,
  type OverviewActivityItem,
  type OverviewAttentionItem,
  type OverviewAttentionKind,
  type OverviewLink,
  type OverviewMetric,
  type OverviewMomentumItem,
  type OverviewPublishItem,
  type OverviewScope,
} from '@/lib/shared/admin-overview'
import { cn } from '@/lib/shared/utils'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { StatusBadge } from '@/components/ui/status-badge'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { TimeAgo } from '@/components/ui/time-ago'
import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'

export function useWorkspaceHomeTitle(): string {
  const { settings } = useRouteContext({ from: '__root__' })
  const branding = (settings as { brandingData?: { name?: string } } | undefined)?.brandingData
  return branding?.name ?? settings?.name ?? 'Home'
}

export function OverviewDashboard({
  scope,
  onScopeChange,
  actions,
  banner,
}: {
  scope: OverviewScope
  onScopeChange: (scope: OverviewScope) => void
  actions?: ReactNode
  banner?: ReactNode
}) {
  const overview = useQuery(adminOverviewQueries.get(scope))
  const [filter, setFilter] = useState<OverviewAttentionKind | 'all'>('all')
  const data = overview.data

  const attention = useMemo(() => {
    const items = data?.attention ?? []
    if (filter === 'all') return items
    return items.filter((item) => item.kind === filter)
  }, [data?.attention, filter])

  const filters = useMemo(() => {
    const kinds: Array<{ id: OverviewAttentionKind | 'all'; label: string }> = [
      { id: 'all', label: 'All' },
    ]
    if (data?.sections.support.enabled) kinds.push({ id: 'support', label: 'Support' })
    if (data?.sections.feedback.enabled) kinds.push({ id: 'feedback', label: 'Feedback' })
    if (data?.sections.feedback.enabled || data?.sections.changelog.enabled) {
      kinds.push({ id: 'publishing', label: 'Publishing' })
    }
    return kinds
  }, [data?.sections])

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          className="min-w-0"
          icon={HomeIcon}
          title="Overview"
          size="large"
          description={
            scope === 'mine'
              ? 'Your owned items, with the rest of the workspace as context.'
              : 'A little context. A clear place to start.'
          }
        />
        <div className="flex flex-wrap items-center gap-2">
          <ScopePills scope={scope} onChange={onScopeChange} />
          {data?.generatedAt ? (
            <p className="hidden text-sm text-muted-foreground lg:block">
              Updated <TimeAgo date={data.generatedAt} />
            </p>
          ) : null}
          {actions}
        </div>
      </div>

      {banner}

      {overview.isError ? (
        <SettingsCard>
          <p className="text-sm text-muted-foreground">
            Couldn’t load the overview.{' '}
            <button type="button" className="underline" onClick={() => void overview.refetch()}>
              Try again
            </button>
          </p>
        </SettingsCard>
      ) : (
        <>
          <MetricsRow
            metrics={data?.metrics ?? []}
            loading={overview.isLoading}
            onFilter={(next) => {
              if (next !== 'articles') setFilter(next)
            }}
          />

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]">
            <div className="space-y-6">
              <SettingsCard
                title="Needs attention"
                description={
                  scope === 'mine'
                    ? 'Your owned items, ordered by what needs you first.'
                    : 'Start with customer replies and time-sensitive work.'
                }
                action={
                  <Badge size="sm" shape="pill" variant="secondary">
                    {attention.length}
                  </Badge>
                }
                contentClassName="p-0 sm:p-0"
              >
                {sectionError(data, ['support', 'feedback']) ? (
                  <SectionError
                    message={sectionError(data, ['support', 'feedback'])!}
                    onRetry={() => void overview.refetch()}
                  />
                ) : (
                  <>
                    {filters.length > 2 ? (
                      <div className="flex flex-wrap gap-1 border-b border-border/50 px-4 py-2.5">
                        {filters.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            aria-pressed={filter === item.id}
                            onClick={() => setFilter(item.id)}
                            className={cn(
                              'rounded-full px-3 py-1.5 text-sm transition-colors',
                              filter === item.id
                                ? 'bg-muted text-foreground font-medium'
                                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                            )}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {overview.isLoading ? (
                      <OverviewSkeleton rows={4} />
                    ) : attention.length === 0 ? (
                      <QuietEmpty message="You’re all caught up here." />
                    ) : (
                      <div className="divide-y divide-border">
                        {attention.map((item) => (
                          <AttentionRow key={item.id} item={item} />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </SettingsCard>

              <SettingsCard
                title="Recent activity"
                description="Updates across your workspace in the last 7 days."
                contentClassName="p-0 sm:p-0"
              >
                {overview.isLoading ? (
                  <OverviewSkeleton rows={4} />
                ) : (data?.activity.length ?? 0) === 0 ? (
                  <QuietEmpty message="No recent workspace activity." />
                ) : (
                  <div className="divide-y divide-border">
                    {data!.activity.map((item) => (
                      <ActivityRow key={item.id} item={item} />
                    ))}
                  </div>
                )}
              </SettingsCard>
            </div>

            <div className="space-y-6">
              <SettingsCard
                title="Gaining momentum"
                description="Most new votes in the last 7 days."
                action={<ChartBarIcon className="size-4 text-muted-foreground" />}
                contentClassName="p-0 sm:p-0"
              >
                {data?.sections.feedback.error ? (
                  <SectionError
                    message={data.sections.feedback.error}
                    onRetry={() => void overview.refetch()}
                  />
                ) : overview.isLoading ? (
                  <OverviewSkeleton rows={3} />
                ) : (data?.momentum.length ?? 0) === 0 ? (
                  <QuietEmpty message="No new votes this week." />
                ) : (
                  <div className="divide-y divide-border">
                    {data!.momentum.map((item) => (
                      <MomentumRow key={item.postId} item={item} />
                    ))}
                  </div>
                )}
              </SettingsCard>

              <SettingsCard
                title="On the publishing desk"
                description="Pick up where your team left off."
                contentClassName="p-0 sm:p-0"
              >
                {data?.sections.changelog.error || data?.sections.helpCenter.error ? (
                  <SectionError
                    message={data.sections.changelog.error || data.sections.helpCenter.error || ''}
                    onRetry={() => void overview.refetch()}
                  />
                ) : overview.isLoading ? (
                  <OverviewSkeleton rows={4} />
                ) : (
                  <PublishingDesk
                    changelog={data?.publishing.changelog ?? []}
                    helpCenter={data?.publishing.helpCenter ?? []}
                    changelogOn={Boolean(data?.sections.changelog.enabled)}
                    helpOn={Boolean(data?.sections.helpCenter.enabled)}
                  />
                )}
              </SettingsCard>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ScopePills({
  scope,
  onChange,
}: {
  scope: OverviewScope
  onChange: (scope: OverviewScope) => void
}) {
  return (
    <div className="flex items-center" aria-label="Work scope">
      {(
        [
          ['team', 'Team'],
          ['mine', 'My work'],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={scope === value}
          onClick={() => onChange(value)}
          className={cn(
            'rounded-full px-3 py-1.5 text-sm transition-colors',
            scope === value
              ? 'bg-muted text-foreground font-medium'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function sectionError(
  data:
    | { sections: { support: { error: string | null }; feedback: { error: string | null } } }
    | undefined,
  keys: Array<'support' | 'feedback'>
): string | null {
  if (!data) return null
  return keys.map((key) => data.sections[key].error).find(Boolean) ?? null
}

function MetricsRow({
  metrics,
  loading,
  onFilter,
}: {
  metrics: OverviewMetric[]
  loading: boolean
  onFilter: (filter: OverviewAttentionKind | 'articles') => void
}) {
  if (loading) {
    return <Skeleton className="h-28 w-full rounded-xl" />
  }
  if (metrics.length === 0) return null
  return (
    <Card className="overflow-hidden py-0 gap-0">
      <div className={cn('grid gap-px bg-border/50', overviewMetricGridClass(metrics.length))}>
        {metrics.map((metric) => (
          <OverviewNavLink
            key={metric.key}
            link={metric.link}
            onClick={() => onFilter(metric.filter)}
            className="min-w-0 bg-card px-3.5 py-3 text-left transition-colors hover:bg-muted/20 sm:px-5 sm:py-4"
          >
            <p className="mb-1.5 truncate text-[11px] font-medium leading-tight text-muted-foreground sm:mb-2 sm:text-xs">
              {metric.label}
            </p>
            <p className="flex flex-wrap items-baseline gap-x-1.5 text-2xl font-bold leading-none tracking-tight tabular-nums sm:text-3xl">
              {metric.count.toLocaleString()}
              <span className="text-sm font-medium text-muted-foreground sm:text-base">
                {metric.unit}
              </span>
            </p>
            {metric.hint ? (
              <p
                className={cn(
                  'mt-1.5 truncate text-xs leading-tight',
                  metric.hintTone === 'urgent' ? 'text-destructive' : 'text-muted-foreground'
                )}
              >
                {metric.hint}
              </p>
            ) : null}
          </OverviewNavLink>
        ))}
      </div>
    </Card>
  )
}

function OverviewEntityRow({
  link,
  title,
  badge,
  badgeColor,
  meta,
  trailing,
}: {
  link: OverviewLink
  title: string
  badge?: string | null
  badgeColor?: string | null
  meta?: string | null
  trailing?: ReactNode
}) {
  return (
    <OverviewNavLink
      link={link}
      className="flex w-full min-w-0 items-start gap-3 px-3 py-3 text-left hover:bg-muted/40 sm:items-center sm:px-4"
    >
      <span className="min-w-0 flex-1">
        <span className="block line-clamp-2 break-words text-sm font-medium">{title}</span>
        {badge || meta ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-2">
            {badge ? (
              <StatusBadge name={badge} color={badgeColor} className="shrink-0 text-[11px]" />
            ) : null}
            {meta ? (
              <span className="min-w-0 truncate text-xs text-muted-foreground">{meta}</span>
            ) : null}
          </span>
        ) : null}
      </span>
      {trailing ? (
        <span className="flex shrink-0 items-center gap-2 pt-0.5 sm:pt-0">{trailing}</span>
      ) : null}
    </OverviewNavLink>
  )
}

function ownerTrailing(name: string | null | undefined) {
  if (!name) return null
  return <Avatar name={name} className="hidden size-7 text-[11px] sm:flex" />
}

function AttentionRow({ item }: { item: OverviewAttentionItem }) {
  return (
    <OverviewEntityRow
      link={item.link}
      title={item.title}
      badge={item.reason}
      badgeColor={item.reasonColor}
      meta={item.meta}
      trailing={ownerTrailing(item.ownerName)}
    />
  )
}

function MomentumRow({ item }: { item: OverviewMomentumItem }) {
  return (
    <OverviewEntityRow
      link={item.link}
      title={item.title}
      badge={item.statusName}
      badgeColor={item.statusColor}
      meta={`${item.boardName} · ${item.voteCount} votes · +${item.votesLast7d} this week`}
    />
  )
}

function PublishingDesk({
  changelog,
  helpCenter,
  changelogOn,
  helpOn,
}: {
  changelog: OverviewPublishItem[]
  helpCenter: OverviewPublishItem[]
  changelogOn: boolean
  helpOn: boolean
}) {
  if (!changelogOn && !helpOn) {
    return <QuietEmpty message="Changelog and Help Center are off." />
  }
  if (changelog.length === 0 && helpCenter.length === 0) {
    return <QuietEmpty message="No drafts or scheduled posts." />
  }
  return (
    <div className="divide-y divide-border">
      {changelogOn ? changelog.map((item) => <PublishRow key={item.id} item={item} />) : null}
      {helpOn ? helpCenter.map((item) => <PublishRow key={item.id} item={item} />) : null}
    </div>
  )
}

function PublishRow({ item }: { item: OverviewPublishItem }) {
  return (
    <OverviewEntityRow
      link={item.link}
      title={item.title}
      badge={publishStatusLabel(item.status)}
      meta={item.meta}
    />
  )
}

function ActivityRow({ item }: { item: OverviewActivityItem }) {
  return (
    <OverviewEntityRow
      link={item.link}
      title={item.title}
      meta={item.event}
      trailing={
        <>
          <TimeAgo date={item.at} className="hidden text-xs text-muted-foreground sm:block" />
          {ownerTrailing(item.actorName)}
        </>
      }
    />
  )
}

function QuietEmpty({ message }: { message: string }) {
  return <p className="px-4 py-10 text-center text-sm text-muted-foreground">{message}</p>
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p className="px-4 py-4 text-sm text-muted-foreground">
      {message}{' '}
      <button type="button" className="underline" onClick={onRetry}>
        Retry
      </button>
    </p>
  )
}

function OverviewSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 px-4 py-4">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full rounded-md" />
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
