import { useQuery } from '@tanstack/react-query'
import { EyeIcon } from '@heroicons/react/24/outline'
import { changelogQueries } from '@/lib/client/queries/changelog'
import type { ChangelogId } from '@quackback/ids'

interface ChangelogTopViewedProps {
  onSelect?: (id: ChangelogId) => void
}

/**
 * Published changelog entries ranked by in-app view count, most-viewed
 * first, rendered as a vertically stacked list of rows so every entry
 * shares one visual encoding and the module scales past a handful of
 * entries without switching layouts. Draft/scheduled entries never
 * appear — a view can only be recorded once an entry is publicly
 * reachable. Email open/click tracking isn't counted here; it requires
 * provider webhooks the in-app counter doesn't have.
 */
export function ChangelogTopViewed({ onSelect }: ChangelogTopViewedProps) {
  const { data, isLoading } = useQuery(changelogQueries.topViewed())

  if (isLoading || !data || data.length === 0) {
    return null
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Top viewed
        </span>
      </div>

      <div className="divide-y divide-border/50">
        {data.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            data-slot="top-viewed-row"
            onClick={() => onSelect?.(entry.id)}
            className="group flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/20 transition-colors"
          >
            <span
              data-slot="top-viewed-rank"
              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground"
            >
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-foreground group-hover:underline underline-offset-2">
              {entry.title}
            </span>
            <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
              <EyeIcon className="size-3.5" />
              {entry.viewCount.toLocaleString()}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
