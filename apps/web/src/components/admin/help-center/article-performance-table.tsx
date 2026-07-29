import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  ChartBarIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  HandThumbDownIcon,
  HandThumbUpIcon,
} from '@heroicons/react/24/outline'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/empty-state'
import { AnalyticsStatRow } from '@/components/admin/analytics/analytics-stat-row'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import { Route } from '@/routes/admin/help-center'
import type { ArticlePerformanceRow } from '@/lib/server/domains/help-center/help-center.article-performance.query'
import type { KbArticleId } from '@quackback/ids'

/**
 * Share of an article's feedback votes that were "helpful", as a whole
 * percent. Null with no votes cast rather than defaulting to 0% or 100% --
 * neither reads as "no data" to an admin scanning the column.
 */
function helpfulRate(helpful: number, notHelpful: number): number | null {
  const total = helpful + notHelpful
  if (total === 0) return null
  return Math.round((helpful / total) * 100)
}

const numberFormatter = new Intl.NumberFormat('en-US')

/**
 * Fleet-wide totals plus the single worst-received article, derived from the
 * same rows the table renders. This is the synthesis an admin would
 * otherwise have to do by eye across every row -- surfaced once, above the
 * row-level detail, instead of left as an exercise for the reader.
 */
function summarizePerformance(rows: ArticlePerformanceRow[]) {
  const totalViews = rows.reduce((sum, row) => sum + row.viewCount, 0)
  const totalHelpful = rows.reduce((sum, row) => sum + row.helpfulCount, 0)
  const totalNotHelpful = rows.reduce((sum, row) => sum + row.notHelpfulCount, 0)
  const overallRate = helpfulRate(totalHelpful, totalNotHelpful)

  // The worst-reacted article is the lowest helpful rate among articles that
  // have actually received votes -- an unvoted article has no reaction to be
  // worst at, so it never wins this slot by defaulting to 0%. Ties broken by
  // vote count so a confident bad signal outranks a single stray downvote.
  const worst = rows
    .filter((row) => row.helpfulCount + row.notHelpfulCount > 0)
    .map((row) => ({
      article: row,
      rate: helpfulRate(row.helpfulCount, row.notHelpfulCount) as number,
      votes: row.helpfulCount + row.notHelpfulCount,
    }))
    .sort((a, b) => a.rate - b.rate || b.votes - a.votes)[0]

  return { totalViews, totalHelpful, totalNotHelpful, overallRate, worst: worst ?? null }
}

export function ArticlePerformanceTable() {
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: rows, isLoading } = useQuery(helpCenterQueries.articlePerformance())
  const summary = rows && rows.length > 0 ? summarizePerformance(rows) : null

  const handleOpen = (id: KbArticleId) => {
    void navigate({ to: '/admin/help-center/articles/$articleId', params: { articleId: id } })
  }

  return (
    <div className="max-w-5xl w-full px-3 pb-4">
      <div className="flex items-center gap-2 px-1 py-3">
        <h1 className="text-lg font-semibold">Article performance</h1>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden mb-4">
          <div className="grid grid-cols-2 divide-x divide-border/50 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-5 py-4">
                <Skeleton className="h-3 w-16 mb-3" />
                <Skeleton className="h-7 w-12" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        summary && (
          <div className="rounded-xl border border-border/50 bg-card overflow-hidden mb-4">
            <AnalyticsStatRow
              stats={[
                { label: 'Total views', value: numberFormatter.format(summary.totalViews) },
                { label: 'Helpful votes', value: numberFormatter.format(summary.totalHelpful) },
                {
                  label: 'Not helpful votes',
                  value: numberFormatter.format(summary.totalNotHelpful),
                },
                {
                  label: 'Overall helpful rate',
                  value: summary.overallRate === null ? '—' : `${summary.overallRate}%`,
                },
              ]}
            />
          </div>
        )
      )}

      {summary?.worst && (
        <button
          type="button"
          data-testid="article-performance-worst"
          onClick={() => handleOpen(summary.worst!.article.id as KbArticleId)}
          className="w-full mb-4 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-left transition-colors hover:bg-amber-500/10"
        >
          <ExclamationTriangleIcon className="size-5 shrink-0 text-amber-600 dark:text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-500">
              Needs attention
            </p>
            <p className="truncate text-[13px] text-foreground">
              <span className="font-medium">{summary.worst.article.title}</span>
              <span className="text-muted-foreground">
                {' '}
                is at {summary.worst.rate}% helpful ({summary.worst.article.notHelpfulCount} not
                helpful vote{summary.worst.article.notHelpfulCount === 1 ? '' : 's'})
              </span>
            </p>
          </div>
        </button>
      )}

      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Ranked by views
          </span>
          {!isLoading && rows && rows.length > 0 && (
            <span className="text-xs text-muted-foreground ml-auto shrink-0">
              {rows.length} article{rows.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              icon={ChartBarIcon}
              title="No article activity yet"
              description="Views and feedback show up here once visitors start reading your articles."
              className="h-32"
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Article</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead className="text-right">Helpful</TableHead>
                <TableHead className="text-right">Not helpful</TableHead>
                <TableHead className="text-right">Helpful rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((article) => {
                const rate = helpfulRate(article.helpfulCount, article.notHelpfulCount)
                return (
                  <TableRow
                    key={article.id}
                    className="cursor-pointer text-[13px]"
                    onClick={() => handleOpen(article.id as KbArticleId)}
                  >
                    <TableCell className="max-w-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge
                          size="sm"
                          shape="pill"
                          variant={article.status === 'published' ? 'default' : 'secondary'}
                          className={
                            article.status === 'published'
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              : undefined
                          }
                        >
                          {article.status === 'published' ? 'Published' : 'Draft'}
                        </Badge>
                        <span className="truncate font-medium text-foreground">
                          {article.title}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-[10rem]">
                      {article.categoryName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center justify-end gap-1 text-foreground">
                        <EyeIcon className="size-3.5 text-muted-foreground/70" />
                        {numberFormatter.format(article.viewCount)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center justify-end gap-1 text-foreground">
                        <HandThumbUpIcon className="size-3.5 text-muted-foreground/70" />
                        {numberFormatter.format(article.helpfulCount)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center justify-end gap-1 text-foreground">
                        <HandThumbDownIcon className="size-3.5 text-muted-foreground/70" />
                        {numberFormatter.format(article.notHelpfulCount)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {rate === null ? '—' : `${rate}%`}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
