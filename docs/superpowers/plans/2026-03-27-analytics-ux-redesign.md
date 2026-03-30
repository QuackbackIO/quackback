# Analytics UX Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the analytics page UX to Featurebase-level polish — remove placeholder/misleading cards, add sparklines to KPI cards, improve chart types, and reorganise the page layout.

**Architecture:** All changes are frontend-only except two read-only additions to `getAnalyticsData` (include `users` in dailyStats and add top changelog entries query). No schema or BullMQ changes. Components are kept in `apps/web/src/components/admin/analytics/`.

**Tech Stack:** React, recharts (via shadcn chart), Tailwind v4, TanStack Query, Drizzle ORM (one new query).

---

## File Map

| File                                                                     | Action     | Responsibility                                                   |
| ------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------- |
| `apps/web/src/lib/server/functions/analytics.ts`                         | Modify     | Add `users` to dailyStats; add top 5 changelog entries query     |
| `apps/web/src/components/admin/analytics/analytics-page.tsx`             | Modify     | New layout, skeleton loading, pass `dailyStats` to summary cards |
| `apps/web/src/components/admin/analytics/analytics-summary-cards.tsx`    | Modify     | Icons, per-metric colours, sparkline bars                        |
| `apps/web/src/components/admin/analytics/analytics-activity-chart.tsx`   | Modify     | Metric toggle pills (Posts/Votes/Comments)                       |
| `apps/web/src/components/admin/analytics/analytics-status-chart.tsx`     | Modify     | Swap horizontal BarChart → donut PieChart with % legend          |
| `apps/web/src/components/admin/analytics/analytics-board-chart.tsx`      | Modify     | Replace recharts with CSS bar list + percentage labels           |
| `apps/web/src/components/admin/analytics/analytics-source-chart.tsx`     | **Delete** | Was hardcoded to "portal" — misleading                           |
| `apps/web/src/components/admin/analytics/analytics-top-contributors.tsx` | Modify     | Replace Table with proportional bar rows                         |
| `apps/web/src/components/admin/analytics/analytics-changelog-card.tsx`   | **Create** | Ranked changelog entries with mini bars + total                  |

---

## Task 1: Extend server function — dailyStats users field + changelog top entries

**Files:**

- Modify: `apps/web/src/lib/server/functions/analytics.ts`

- [ ] **Step 1: Add `users` to the dailyStats mapping**

  Find the `dailyStats` mapping (around line 78) and add the `users` field:

  ```ts
  // Before:
  const dailyStats = currentRows.map((r) => ({
    date: r.date,
    posts: r.newPosts,
    votes: r.newVotes,
    comments: r.newComments,
  }))

  // After:
  const dailyStats = currentRows.map((r) => ({
    date: r.date,
    posts: r.newPosts,
    votes: r.newVotes,
    comments: r.newComments,
    users: r.newUsers,
  }))
  ```

- [ ] **Step 2: Add `desc` to the import and query top changelog entries**

  The file already imports `changelogEntries`, `isNull`, and `sum` from `@/lib/server/db`. Add `desc` to that import, then add the new query right after the existing changelog query (around line 212):

  ```ts
  // Add desc to imports:
  import {
    db,
    sql,
    eq,
    gte,
    isNull,
    sum,
    desc, // ADD THIS
    analyticsDailyStats,
    analyticsTopPosts,
    postStatuses,
    changelogEntries,
    boards,
  } from '@/lib/server/db'
  ```

  ```ts
  // After the existing changelogResult query, add:
  const topChangelogEntries = await db
    .select({
      id: changelogEntries.id,
      title: changelogEntries.title,
      viewCount: changelogEntries.viewCount,
    })
    .from(changelogEntries)
    .where(isNull(changelogEntries.deletedAt))
    .orderBy(desc(changelogEntries.viewCount))
    .limit(5)
  ```

- [ ] **Step 3: Update the return value**

  Find the return statement at the bottom and update `changelog`:

  ```ts
  // Before:
  changelog: { totalViews, totalReactions: 0 },

  // After:
  changelog: {
    totalViews,
    totalReactions: 0,
    topEntries: topChangelogEntries.map((e) => ({
      id: e.id,
      title: e.title,
      viewCount: e.viewCount,
    })),
  },
  ```

- [ ] **Step 4: Verify types**

  ```bash
  cd /home/james/featurepool && bun run typecheck 2>&1 | head -30
  ```

  Expected: no new errors.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/src/lib/server/functions/analytics.ts
  git commit -m "feat(analytics): add users to dailyStats and top changelog entries"
  ```

---

## Task 2: Delete source chart component

**Files:**

- Delete: `apps/web/src/components/admin/analytics/analytics-source-chart.tsx`
- Modify: `apps/web/src/components/admin/analytics/analytics-page.tsx`

The source breakdown chart is hardcoded to always show a single "portal" bar. It conveys no information.

- [ ] **Step 1: Delete the file**

  ```bash
  rm apps/web/src/components/admin/analytics/analytics-source-chart.tsx
  ```

- [ ] **Step 2: Remove the import and usage from analytics-page.tsx**

  Remove this import:

  ```ts
  import { AnalyticsSourceChart } from './analytics-source-chart'
  ```

  And remove the entire Card block that renders it (the "Source breakdown" card in the "Source + Changelog" row).

- [ ] **Step 3: Verify**

  ```bash
  bun run typecheck 2>&1 | head -20
  ```

  Expected: no errors related to `AnalyticsSourceChart`.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/src/components/admin/analytics/analytics-source-chart.tsx \
          apps/web/src/components/admin/analytics/analytics-page.tsx
  git commit -m "feat(analytics): remove misleading source breakdown chart"
  ```

---

## Task 3: KPI summary cards — icons, sparklines, layout

**Files:**

- Modify: `apps/web/src/components/admin/analytics/analytics-summary-cards.tsx`

- [ ] **Step 1: Rewrite analytics-summary-cards.tsx**

  ```tsx
  import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
  import { Card, CardContent } from '@/components/ui/card'
  import { cn } from '@/lib/shared/utils'

  interface SummaryCardsProps {
    summary: {
      posts: { total: number; delta: number }
      votes: { total: number; delta: number }
      comments: { total: number; delta: number }
      users: { total: number; delta: number }
    }
    dailyStats: Array<{
      date: string
      posts: number
      votes: number
      comments: number
      users: number
    }>
  }

  const METRIC_CONFIG = [
    {
      key: 'posts' as const,
      label: 'Posts',
      icon: '📝',
      color: '#6366f1',
      iconBg: 'bg-indigo-500/10',
    },
    {
      key: 'votes' as const,
      label: 'Votes',
      icon: '👍',
      color: '#22c55e',
      iconBg: 'bg-green-500/10',
    },
    {
      key: 'comments' as const,
      label: 'Comments',
      icon: '💬',
      color: '#f59e0b',
      iconBg: 'bg-amber-500/10',
    },
    {
      key: 'users' as const,
      label: 'Users',
      icon: '👤',
      color: '#8b5cf6',
      iconBg: 'bg-violet-500/10',
    },
  ] as const

  export function AnalyticsSummaryCards({ summary, dailyStats }: SummaryCardsProps) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {METRIC_CONFIG.map(({ key, label, icon, color, iconBg }) => {
          const { total, delta } = summary[key]
          const sparkData = dailyStats.map((d) => d[key])
          return (
            <Card key={key}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-lg text-sm',
                        iconBg
                      )}
                    >
                      {icon}
                    </div>
                    <p className="text-sm text-muted-foreground">{label}</p>
                  </div>
                  <DeltaBadge delta={delta} />
                </div>
                <p className="mt-2 text-3xl font-bold tracking-tight">{total.toLocaleString()}</p>
                <Sparkline data={sparkData} color={color} />
              </CardContent>
            </Card>
          )
        })}
      </div>
    )
  }

  function Sparkline({ data, color }: { data: number[]; color: string }) {
    const max = Math.max(...data, 1)
    if (data.length === 0) return null
    return (
      <div className="mt-2 flex h-6 items-end gap-px">
        {data.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm rounded-b-none"
            style={{
              height: `${Math.max((v / max) * 100, 4)}%`,
              background: color,
              opacity: 0.3 + (i / (data.length - 1)) * 0.6,
            }}
          />
        ))}
      </div>
    )
  }

  function DeltaBadge({ delta }: { delta: number }) {
    if (delta === 0) return null
    const isPositive = delta > 0
    return (
      <span
        className={cn(
          'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium',
          isPositive
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : 'bg-red-500/10 text-red-600 dark:text-red-400'
        )}
      >
        {isPositive ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />}
        {Math.abs(delta)}%
      </span>
    )
  }
  ```

- [ ] **Step 2: Pass `dailyStats` in analytics-page.tsx**

  Find the `<AnalyticsSummaryCards>` usage and add the prop:

  ```tsx
  // Before:
  <AnalyticsSummaryCards summary={data.summary} />

  // After:
  <AnalyticsSummaryCards summary={data.summary} dailyStats={data.dailyStats} />
  ```

- [ ] **Step 3: Verify**

  ```bash
  bun run typecheck 2>&1 | head -20
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/src/components/admin/analytics/analytics-summary-cards.tsx \
          apps/web/src/components/admin/analytics/analytics-page.tsx
  git commit -m "feat(analytics): add icons and sparklines to KPI summary cards"
  ```

---

## Task 4: Activity chart — metric toggle pills

**Files:**

- Modify: `apps/web/src/components/admin/analytics/analytics-activity-chart.tsx`

- [ ] **Step 1: Rewrite analytics-activity-chart.tsx**

  ```tsx
  import { useState } from 'react'
  import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
  } from '@/components/ui/chart'
  import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts'
  import { cn } from '@/lib/shared/utils'

  interface ActivityChartProps {
    dailyStats: Array<{ date: string; posts: number; votes: number; comments: number }>
  }

  const METRICS = [
    { key: 'posts', label: 'Posts', color: 'hsl(var(--chart-1))' },
    { key: 'votes', label: 'Votes', color: 'hsl(var(--chart-2))' },
    { key: 'comments', label: 'Comments', color: 'hsl(var(--chart-3))' },
  ] as const

  type MetricKey = (typeof METRICS)[number]['key']

  const chartConfig: ChartConfig = {
    posts: { label: 'Posts', color: 'hsl(var(--chart-1))' },
    votes: { label: 'Votes', color: 'hsl(var(--chart-2))' },
    comments: { label: 'Comments', color: 'hsl(var(--chart-3))' },
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  export function AnalyticsActivityChart({ dailyStats }: ActivityChartProps) {
    const [active, setActive] = useState<Set<MetricKey>>(new Set(['posts', 'votes', 'comments']))

    function toggle(key: MetricKey) {
      setActive((prev) => {
        if (prev.has(key) && prev.size === 1) return prev // keep at least one
        const next = new Set(prev)
        next.has(key) ? next.delete(key) : next.add(key)
        return next
      })
    }

    if (dailyStats.length === 0) {
      return (
        <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
          No data for this period
        </div>
      )
    }

    return (
      <div>
        <div className="mb-3 flex items-center gap-2">
          {METRICS.map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => toggle(key)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                active.has(key)
                  ? 'border-transparent text-white'
                  : 'border-border bg-transparent text-muted-foreground hover:text-foreground'
              )}
              style={active.has(key) ? { background: color, borderColor: color } : undefined}
            >
              {label}
            </button>
          ))}
        </div>
        <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
          <AreaChart data={dailyStats} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={formatDate}
            />
            <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
            <ChartTooltip
              content={
                <ChartTooltipContent labelFormatter={(label) => formatDate(String(label))} />
              }
            />
            {METRICS.filter(({ key }) => active.has(key)).map(({ key }) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={`var(--color-${key})`}
                fill={`var(--color-${key})`}
                fillOpacity={0.12}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      </div>
    )
  }
  ```

- [ ] **Step 2: Verify**

  ```bash
  bun run typecheck 2>&1 | head -20
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/web/src/components/admin/analytics/analytics-activity-chart.tsx
  git commit -m "feat(analytics): add metric toggle pills to activity chart"
  ```

---

## Task 5: Status chart — donut with percentage legend

**Files:**

- Modify: `apps/web/src/components/admin/analytics/analytics-status-chart.tsx`

- [ ] **Step 1: Rewrite analytics-status-chart.tsx**

  The existing `analytics-source-chart.tsx` (now deleted) used the same donut pattern — use that as a reference. Status data has `color` per item already, so no colour array needed.

  ```tsx
  import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
  } from '@/components/ui/chart'
  import { PieChart, Pie, Cell } from 'recharts'
  import { useMemo } from 'react'

  interface StatusChartProps {
    data: Array<{ status: string; color: string; count: number }>
  }

  export function AnalyticsStatusChart({ data }: StatusChartProps) {
    const sorted = useMemo(() => [...data].sort((a, b) => b.count - a.count), [data])
    const total = useMemo(() => sorted.reduce((sum, d) => sum + d.count, 0), [sorted])

    const chartConfig = useMemo(() => {
      const config: ChartConfig = {}
      for (const item of sorted) {
        config[item.status] = { label: item.status, color: item.color }
      }
      return config
    }, [sorted])

    if (sorted.length === 0) {
      return (
        <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
          No data for this period
        </div>
      )
    }

    return (
      <div className="flex items-center gap-6 py-2">
        <ChartContainer config={chartConfig} className="h-[180px] w-[180px] shrink-0">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="status" />} />
            <Pie
              data={sorted}
              dataKey="count"
              nameKey="status"
              innerRadius={52}
              outerRadius={80}
              strokeWidth={2}
              stroke="hsl(var(--background))"
            >
              {sorted.map((entry) => (
                <Cell key={entry.status} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="flex flex-1 flex-col gap-2">
          {sorted.map((item) => {
            const pct = total > 0 ? Math.round((item.count / total) * 100) : 0
            return (
              <div key={item.status} className="flex items-center gap-2 text-sm">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: item.color }}
                />
                <span className="flex-1 truncate text-muted-foreground">{item.status}</span>
                <span className="font-medium">{pct}%</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 2: Verify**

  ```bash
  bun run typecheck 2>&1 | head -20
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/web/src/components/admin/analytics/analytics-status-chart.tsx
  git commit -m "feat(analytics): replace status bar chart with donut and percentage legend"
  ```

---

## Task 6: Board chart — CSS bar list with percentage labels

**Files:**

- Modify: `apps/web/src/components/admin/analytics/analytics-board-chart.tsx`

- [ ] **Step 1: Rewrite analytics-board-chart.tsx**

  Replace the recharts implementation with a CSS-based bar list. This gives cleaner control over the percentage labels.

  ```tsx
  import { useMemo } from 'react'

  interface BoardChartProps {
    data: Array<{ board: string; count: number }>
  }

  export function AnalyticsBoardChart({ data }: BoardChartProps) {
    const sorted = useMemo(() => [...data].sort((a, b) => b.count - a.count), [data])
    const total = useMemo(() => sorted.reduce((sum, d) => sum + d.count, 0), [sorted])
    const maxCount = sorted[0]?.count ?? 1

    if (sorted.length === 0) {
      return (
        <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
          No data for this period
        </div>
      )
    }

    return (
      <div className="flex flex-col gap-3 py-2">
        {sorted.map((item) => {
          const pct = total > 0 ? Math.round((item.count / total) * 100) : 0
          const barWidth = (item.count / maxCount) * 100
          return (
            <div key={item.board} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm">{item.board}</span>
                <div className="flex shrink-0 items-baseline gap-1.5">
                  <span className="text-sm font-semibold tabular-nums">{item.count}</span>
                  <span className="text-xs text-muted-foreground">{pct}%</span>
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/60"
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    )
  }
  ```

- [ ] **Step 2: Verify**

  ```bash
  bun run typecheck 2>&1 | head -20
  ```

  Expected: no errors. Note: `ChartContainer`, `ChartConfig`, and recharts imports are no longer needed in this file — TypeScript will flag them if they remain.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/web/src/components/admin/analytics/analytics-board-chart.tsx
  git commit -m "feat(analytics): replace board bar chart with CSS bar list with percentages"
  ```

---

## Task 7: New changelog card component

**Files:**

- Create: `apps/web/src/components/admin/analytics/analytics-changelog-card.tsx`

- [ ] **Step 1: Create analytics-changelog-card.tsx**

  ```tsx
  interface ChangelogCardProps {
    topEntries: Array<{ id: string; title: string; viewCount: number }>
    totalViews: number
  }

  export function AnalyticsChangelogCard({ topEntries, totalViews }: ChangelogCardProps) {
    const maxViews = Math.max(...topEntries.map((e) => e.viewCount), 1)

    if (topEntries.length === 0) {
      return (
        <div className="flex h-[250px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          No changelog entries yet
        </div>
      )
    }

    return (
      <div className="flex flex-col gap-2.5 py-2">
        {topEntries.map((entry) => {
          const barWidth = (entry.viewCount / maxViews) * 100
          return (
            <div key={entry.id} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm">{entry.title}</span>
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  {entry.viewCount.toLocaleString()}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/40"
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          )
        })}
        <p className="mt-1 text-right text-xs text-muted-foreground">
          {totalViews.toLocaleString()} total views
        </p>
      </div>
    )
  }
  ```

- [ ] **Step 2: Verify**

  ```bash
  bun run typecheck 2>&1 | head -20
  ```

  Expected: no errors (the component isn't imported anywhere yet — that happens in Task 9).

- [ ] **Step 3: Commit**

  ```bash
  git add apps/web/src/components/admin/analytics/analytics-changelog-card.tsx
  git commit -m "feat(analytics): add changelog views card with ranked entries"
  ```

---

## Task 8: Top contributors — proportional bar rows

**Files:**

- Modify: `apps/web/src/components/admin/analytics/analytics-top-contributors.tsx`

- [ ] **Step 1: Rewrite analytics-top-contributors.tsx**

  ```tsx
  import { Avatar } from '@/components/ui/avatar'

  interface TopContributorsProps {
    contributors: Array<{
      principalId: string
      displayName: string | null
      avatarUrl: string | null
      posts: number
      votes: number
      comments: number
      total: number
    }>
  }

  export function AnalyticsTopContributors({ contributors }: TopContributorsProps) {
    if (contributors.length === 0) {
      return (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          No contributor activity in this period
        </div>
      )
    }

    const maxTotal = Math.max(...contributors.map((c) => c.total), 1)

    return (
      <div className="flex flex-col divide-y divide-border">
        {contributors.map((c) => {
          const barWidth = (c.total / maxTotal) * 100
          return (
            <div key={c.principalId} className="flex items-center gap-3 py-2.5">
              <Avatar src={c.avatarUrl} name={c.displayName} className="size-7 shrink-0 text-xs" />
              <span className="flex-1 truncate text-sm font-medium">
                {c.displayName ?? 'Anonymous'}
              </span>
              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/50"
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              <span className="w-8 text-right text-sm font-bold tabular-nums">{c.total}</span>
            </div>
          )
        })}
      </div>
    )
  }
  ```

- [ ] **Step 2: Verify**

  ```bash
  bun run typecheck 2>&1 | head -20
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/web/src/components/admin/analytics/analytics-top-contributors.tsx
  git commit -m "feat(analytics): replace contributors table with proportional bar rows"
  ```

---

## Task 9: Page layout reorganisation + skeleton loading

**Files:**

- Modify: `apps/web/src/components/admin/analytics/analytics-page.tsx`

This task wires everything together with the new layout and replaces the spinner with skeleton cards.

- [ ] **Step 1: Rewrite analytics-page.tsx**

  ```tsx
  import { useState } from 'react'
  import { keepPreviousData, useQuery } from '@tanstack/react-query'
  import { analyticsQueries, type AnalyticsPeriod } from '@/lib/client/queries/analytics'
  import { formatDistanceToNow } from 'date-fns'
  import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
  import { Button } from '@/components/ui/button'
  import { ScrollArea } from '@/components/ui/scroll-area'
  import { Skeleton } from '@/components/ui/skeleton'
  import { AnalyticsSummaryCards } from './analytics-summary-cards'
  import { AnalyticsActivityChart } from './analytics-activity-chart'
  import { AnalyticsStatusChart } from './analytics-status-chart'
  import { AnalyticsBoardChart } from './analytics-board-chart'
  import { AnalyticsChangelogCard } from './analytics-changelog-card'
  import { AnalyticsTopPosts } from './analytics-top-posts'
  import { AnalyticsTopContributors } from './analytics-top-contributors'

  const periods: Array<{ value: AnalyticsPeriod; label: string }> = [
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: '90d', label: '90d' },
    { value: '12m', label: '12m' },
  ]

  export function AnalyticsPage() {
    const [period, setPeriod] = useState<AnalyticsPeriod>('30d')

    const { data, isLoading } = useQuery({
      ...analyticsQueries.data(period),
      placeholderData: keepPreviousData,
    })

    const periodSelector = (
      <div className="flex items-center gap-1 rounded-lg border border-border/50 p-1">
        {periods.map(({ value, label }) => (
          <Button
            key={value}
            variant={period === value ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setPeriod(value)}
          >
            {label}
          </Button>
        ))}
      </div>
    )

    if (isLoading) {
      return (
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-6 p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
              {periodSelector}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-72 rounded-xl" />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-60 rounded-xl" />
              ))}
            </div>
            <div className="grid grid-cols-5 gap-6">
              <Skeleton className="col-span-3 h-72 rounded-xl" />
              <Skeleton className="col-span-2 h-72 rounded-xl" />
            </div>
          </div>
        </ScrollArea>
      )
    }

    if (!data) return null

    return (
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-6 p-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
              {data.computedAt && (
                <p className="text-sm text-muted-foreground">
                  Last updated {formatDistanceToNow(new Date(data.computedAt), { addSuffix: true })}
                </p>
              )}
            </div>
            {periodSelector}
          </div>

          {/* KPI cards with sparklines */}
          <AnalyticsSummaryCards summary={data.summary} dailyStats={data.dailyStats} />

          {/* Activity over time */}
          <Card>
            <CardHeader>
              <CardTitle>Activity over time</CardTitle>
            </CardHeader>
            <CardContent>
              <AnalyticsActivityChart dailyStats={data.dailyStats} />
            </CardContent>
          </Card>

          {/* Breakdown row: status + boards + changelog */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Status distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <AnalyticsStatusChart data={data.statusDistribution} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Boards</CardTitle>
              </CardHeader>
              <CardContent>
                <AnalyticsBoardChart data={data.boardBreakdown} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Changelog views</CardTitle>
              </CardHeader>
              <CardContent>
                <AnalyticsChangelogCard
                  topEntries={data.changelog.topEntries}
                  totalViews={data.changelog.totalViews}
                />
              </CardContent>
            </Card>
          </div>

          {/* Bottom row: top posts + contributors */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Top posts</CardTitle>
              </CardHeader>
              <CardContent>
                <AnalyticsTopPosts posts={data.topPosts} />
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Top contributors</CardTitle>
              </CardHeader>
              <CardContent>
                <AnalyticsTopContributors contributors={data.topContributors} />
              </CardContent>
            </Card>
          </div>
        </div>
      </ScrollArea>
    )
  }
  ```

- [ ] **Step 2: Typecheck and lint**

  ```bash
  bun run typecheck 2>&1 | head -30
  bun run lint 2>&1 | head -30
  ```

  Expected: no errors.

- [ ] **Step 3: Smoke test in the browser**

  ```bash
  bun run dev
  ```

  Navigate to `http://localhost:3001` → log in as `demo@example.com` / `password` → go to Analytics. Verify:
  - [ ] Skeleton cards show on first load, not a spinner
  - [ ] 4 KPI cards render with icons and sparklines
  - [ ] Activity chart renders with Posts/Votes/Comments toggle pills; clicking a pill hides/shows that series
  - [ ] Status card shows a donut chart with % in the legend
  - [ ] Boards card shows bars with count + % labels
  - [ ] Changelog views card shows ranked entries (may be empty if no entries — that's fine)
  - [ ] Bottom row: top posts left (3 cols), contributors right (2 cols)
  - [ ] No "Source breakdown" card anywhere

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/src/components/admin/analytics/analytics-page.tsx
  git commit -m "feat(analytics): reorganise page layout and add skeleton loading state"
  ```

---

## Final verification

- [ ] **Run full checks**

  ```bash
  bun run typecheck && bun run lint
  ```

  Expected: both pass.
