import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/shared/utils'
import { CHART_HEIGHT_CLASS } from './analytics-constants'
import { COLS } from './analytics-stat-row'
import type { Section } from './analytics-sections'

/** A plain pulsing block sized by the caller. Used for the hero activity chart,
 *  whose skeleton must share CHART_HEIGHT_CLASS so the layout never jumps. */
export function ChartSkeleton({ className }: { className?: string }) {
  return <div className={cn('w-full rounded-md bg-muted/50 animate-pulse', className)} />
}

/** Loading placeholder for the status donut. Mirrors AnalyticsStatusChart's
 *  layout (round chart on the left, legend rows on the right) so the Suspense
 *  fallback doesn't pop from a rectangle into a circle. */
export function StatusChartSkeleton() {
  return (
    <div className="flex items-center gap-6 py-2">
      <Skeleton className="size-[180px] shrink-0 rounded-full" />
      <div className="flex flex-1 flex-col gap-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="size-2 shrink-0 rounded-full" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-8" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Divided headline-stat tiles, matching AnalyticsStatRow's responsive columns. */
function StatRowSkeleton({ cols }: { cols: 3 | 4 }) {
  return (
    <div className={cn('grid divide-x divide-border/50', COLS[cols])}>
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className="px-5 py-4">
          <Skeleton className="mb-2 h-3 w-16" />
          <Skeleton className="h-7 w-20" />
        </div>
      ))}
    </div>
  )
}

// Descending widths so the bar-list placeholder reads as ranked rows, not a
// uniform block.
const BAR_WIDTHS = ['90%', '78%', '70%', '64%', '58%', '52%', '48%']

/** Loading placeholder for an AnalyticsBarList (Boards, Top posts, Contributors,
 *  Changelog, Signups by source). */
function BarListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-10" />
      </div>
      <div className="flex flex-col">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-2.5 py-2">
            <Skeleton className="h-4" style={{ width: BAR_WIDTHS[i % BAR_WIDTHS.length] }} />
            <Skeleton className="ml-auto h-4 w-6" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** A titled card wrapping a bar-list skeleton, matching the Boards / Top posts /
 *  Signups cards. Card titles are static chrome, so show them for real. */
function ListCardSkeleton({ title, rows }: { title: string; rows?: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <BarListSkeleton rows={rows} />
      </CardContent>
    </Card>
  )
}

/** A section card matching StatSection: a stat row over a hairline-divided
 *  visual. */
function StatSectionSkeleton({ cols, children }: { cols: 3 | 4; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden py-0 gap-0">
      <StatRowSkeleton cols={cols} />
      <div className="border-t border-border/50 px-6 py-6">{children}</div>
    </Card>
  )
}

/** Loading state shaped like the section it stands in for, so the layout does
 *  not reflow when data arrives. */
export function SectionSkeleton({ section }: { section: Section }) {
  if (section === 'feedback') {
    return (
      <div className="flex flex-col gap-6">
        <StatSectionSkeleton cols={4}>
          <StatusChartSkeleton />
        </StatSectionSkeleton>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
          <ListCardSkeleton title="Boards" />
          <ListCardSkeleton title="Top posts" />
        </div>
      </div>
    )
  }

  if (section === 'users') {
    return (
      <div className="flex flex-col gap-6">
        <StatSectionSkeleton cols={4}>
          <BarListSkeleton />
        </StatSectionSkeleton>
        <ListCardSkeleton title="Signups by source" rows={4} />
      </div>
    )
  }

  if (section === 'changelog' || section === 'support') {
    return (
      <StatSectionSkeleton cols={3}>
        <BarListSkeleton rows={5} />
      </StatSectionSkeleton>
    )
  }

  // Overview: the four summary tiles over the hero activity chart.
  return (
    <Card className="overflow-hidden py-0 gap-0">
      <StatRowSkeleton cols={4} />
      <div className="border-t border-border/50 px-6 pt-7 pb-6">
        <ChartSkeleton className={cn(CHART_HEIGHT_CLASS, 'rounded-lg')} />
      </div>
    </Card>
  )
}
