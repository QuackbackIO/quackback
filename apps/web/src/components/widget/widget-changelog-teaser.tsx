import { useInfiniteQuery } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import { contentPreview } from '@/lib/shared/utils/string'
import { publicChangelogQueries } from '@/lib/client/queries/changelog'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

interface WidgetChangelogTeaserProps {
  /** Open a single changelog entry (changelog-detail view). */
  onOpenEntry: (entryId: string) => void
  /** Open the full changelog. */
  onSeeAll: () => void
}

/**
 * Ambient "we ship" teaser for the Home overview: the single newest published
 * changelog entry. Renders nothing when there are no entries yet, so the Home
 * never shows an empty changelog section (the Changelog tab owns the empty
 * state). Reads the first page of the same query the Changelog tab uses, so
 * they never disagree about whether content exists.
 */
export function WidgetChangelogTeaser({ onOpenEntry, onSeeAll }: WidgetChangelogTeaserProps) {
  const { data } = useInfiniteQuery(publicChangelogQueries.list())
  const latest = data?.pages[0]?.items[0]
  if (!latest) return null

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-2">
      <div className="flex items-center justify-between px-2 pt-1.5 pb-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
          <FormattedMessage id="widget.launcher.changelog.heading" defaultMessage="What's new" />
        </p>
        <button
          type="button"
          onClick={onSeeAll}
          className="text-[11px] text-primary hover:underline"
        >
          <FormattedMessage id="widget.launcher.changelog.seeAll" defaultMessage="See all" />
        </button>
      </div>
      <button
        type="button"
        onClick={() => onOpenEntry(latest.id)}
        className="w-full rounded-xl px-2 py-2 text-start transition-colors hover:bg-accent"
      >
        <time className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide">
          {formatDate(latest.publishedAt)}
        </time>
        <h3 className="mt-0.5 text-sm font-semibold text-foreground line-clamp-1 leading-snug">
          {latest.title}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground/70 line-clamp-2 leading-relaxed">
          {contentPreview(latest.content, 120)}
        </p>
      </button>
    </div>
  )
}
