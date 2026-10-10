import { FormattedDate, FormattedMessage } from 'react-intl'
import { cn } from '@/lib/shared/utils'

/**
 * The one-line "when / what kind / is it new" strip above a changelog title.
 * Shared by the list card and the entry view so the two read identically.
 */
export function ChangelogMetaRow({
  publishedAt,
  categories,
  isNew = false,
  long = false,
  className,
}: {
  publishedAt: string
  categories: readonly { id: string; name: string; color: string }[]
  isNew?: boolean
  /** Long month name (entry view) vs. short (list card). */
  long?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <time
        dateTime={publishedAt}
        className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide"
      >
        <FormattedDate
          value={publishedAt}
          month={long ? 'long' : 'short'}
          day="numeric"
          year="numeric"
        />
      </time>
      {isNew && (
        <span className="inline-flex items-center rounded-full bg-primary px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-primary-foreground">
          <FormattedMessage id="widget.changelog.new" defaultMessage="New" />
        </span>
      )}
      {categories.map((category) => (
        <span
          key={category.id}
          className="inline-flex items-center rounded-full px-1.5 py-px text-[11px] font-medium"
          style={{ backgroundColor: category.color + '1a', color: category.color }}
        >
          {category.name}
        </span>
      ))}
    </div>
  )
}
