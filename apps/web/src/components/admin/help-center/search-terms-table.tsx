import { useQuery } from '@tanstack/react-query'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'
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
import { TimeAgo } from '@/components/ui/time-ago'
import { helpCenterQueries } from '@/lib/client/queries/help-center'

const numberFormatter = new Intl.NumberFormat('en-US')

/**
 * Most-searched visitor queries over the trailing 30 days, ranked by volume.
 * Terms whose searches all missed are flagged -- those are the articles
 * visitors looked for and never found.
 */
export function SearchTermsTable() {
  const { data: rows, isLoading } = useQuery(helpCenterQueries.searchTerms())

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Visitor search terms
        </span>
        {!isLoading && rows && rows.length > 0 && (
          <span className="text-xs text-muted-foreground ml-auto shrink-0">
            {rows.length} term{rows.length === 1 ? '' : 's'}, last 30 days
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="p-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : !rows || rows.length === 0 ? (
        <div className="px-4 py-8">
          <EmptyState
            icon={MagnifyingGlassIcon}
            title="No searches yet"
            description="Visitor search terms show up here once people start searching your help center."
            className="h-32"
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Query</TableHead>
              <TableHead className="text-right">Searches</TableHead>
              <TableHead className="text-right">No results</TableHead>
              <TableHead className="text-right">Last searched</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const alwaysMisses = row.zeroResultSearches === row.searches
              return (
                <TableRow key={row.normalizedQuery} className="text-[13px]">
                  <TableCell className="max-w-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate font-medium text-foreground">{row.term}</span>
                      {alwaysMisses && (
                        <Badge
                          size="sm"
                          shape="pill"
                          variant="secondary"
                          data-testid={`search-term-no-results-${row.normalizedQuery}`}
                          className="bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0"
                        >
                          No results
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-foreground">
                    {numberFormatter.format(row.searches)}
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums text-muted-foreground"
                    data-testid={`search-term-misses-${row.normalizedQuery}`}
                  >
                    {row.zeroResultSearches > 0
                      ? numberFormatter.format(row.zeroResultSearches)
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    <TimeAgo date={row.lastSearchedAt} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
