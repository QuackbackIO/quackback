/**
 * The keyword-in-context line on an inbox search result: the excerpt of the
 * message the term matched, with the term itself highlighted in place. This is
 * what turns a filtered list into a results list — the row stops merely
 * being present and says why it is.
 *
 * Segments arrive as data from the search (never as markup), and render as
 * React text nodes, so a message body can't inject anything here.
 */
import type { TermSegment } from '@/lib/shared/utils/keyword-context'

export function SearchSnippet({ segments }: { segments: TermSegment[] }) {
  return (
    <>
      {segments.map((segment, i) =>
        segment.match ? (
          <mark key={i} className="rounded-[3px] bg-primary/15 px-0.5 font-medium text-foreground">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      )}
    </>
  )
}
