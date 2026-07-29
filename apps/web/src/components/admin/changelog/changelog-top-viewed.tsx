import { useQuery } from '@tanstack/react-query'
import { EyeIcon } from '@heroicons/react/24/outline'
import { Badge } from '@/components/ui/badge'
import { changelogQueries } from '@/lib/client/queries/changelog'
import type { ChangelogId } from '@quackback/ids'

interface ChangelogTopViewedProps {
  onSelect?: (id: ChangelogId) => void
}

/**
 * Published changelog entries ranked by in-app view count, most-viewed
 * first. Draft/scheduled entries never appear — a view can only be recorded
 * once an entry is publicly reachable. Email open/click tracking isn't
 * counted here; it requires provider webhooks the in-app counter doesn't have.
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
      <table className="w-full">
        <tbody className="divide-y divide-border/50">
          {data.map((entry, index) => (
            <tr
              key={entry.id}
              className="group cursor-pointer hover:bg-muted/20 transition-colors"
              onClick={() => onSelect?.(entry.id)}
            >
              <td className="w-10 pl-4 py-2.5 text-sm tabular-nums text-muted-foreground/60">
                {index + 1}
              </td>
              <td className="py-2.5 pr-3 text-sm text-foreground truncate max-w-0 w-full">
                <span className="truncate block group-hover:underline underline-offset-2">
                  {entry.title}
                </span>
              </td>
              <td className="pr-4 py-2.5 text-right">
                <Badge size="sm" variant="subtle" shape="pill">
                  <EyeIcon className="size-2.5" />
                  {entry.viewCount.toLocaleString()}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
