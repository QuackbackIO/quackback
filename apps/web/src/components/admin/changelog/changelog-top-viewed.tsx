import { useQuery } from '@tanstack/react-query'
import { EyeIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import { changelogQueries } from '@/lib/client/queries/changelog'
import type { ChangelogId } from '@quackback/ids'

interface ChangelogTopViewedProps {
  onSelect?: (id: ChangelogId) => void
}

/**
 * Number of entries the headline card treatment can hold. Entries beyond
 * this are left off the module rather than falling back to a second,
 * smaller encoding — every entry shown here reads at the same visual
 * weight.
 */
const HEADLINE_COUNT = 3

const HEADLINE_GRID_CLASS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
}

/**
 * Published changelog entries ranked by in-app view count, most-viewed
 * first, rendered as a fixed-size row of oversized headline cards so every
 * entry shares one visual encoding. Draft/scheduled entries never appear —
 * a view can only be recorded once an entry is publicly reachable. Email
 * open/click tracking isn't counted here; it requires provider webhooks
 * the in-app counter doesn't have.
 */
export function ChangelogTopViewed({ onSelect }: ChangelogTopViewedProps) {
  const { data, isLoading } = useQuery(changelogQueries.topViewed())

  if (isLoading || !data || data.length === 0) {
    return null
  }

  const headline = data.slice(0, HEADLINE_COUNT)

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Top viewed
        </span>
      </div>

      <div className={cn('grid divide-x divide-border/50', HEADLINE_GRID_CLASS[headline.length])}>
        {headline.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onSelect?.(entry.id)}
            className="group flex flex-col items-start gap-1 px-4 py-3 text-left hover:bg-muted/20 transition-colors min-w-0"
          >
            <span className="text-2xl sm:text-3xl leading-none font-bold tabular-nums tracking-tight text-foreground">
              {entry.viewCount.toLocaleString()}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <EyeIcon className="size-3" />
              views
            </span>
            <span className="mt-1 w-full truncate text-xs text-muted-foreground group-hover:text-foreground group-hover:underline underline-offset-2">
              {entry.title}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
