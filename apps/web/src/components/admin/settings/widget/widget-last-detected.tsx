import { TimeAgo } from '@/components/ui/time-ago'
import { NUMERIC_DATE_TIME, useLocalDateFormatter } from '@/components/ui/local-date'

/** Relative “Last detected …” line for the widget install ping. */
export function WidgetLastDetected({ at, inline }: { at?: string | null; inline?: boolean }) {
  const formatDate = useLocalDateFormatter()
  if (!at) return null
  const parsed = new Date(at)
  if (Number.isNaN(parsed.getTime())) return null
  const title = formatDate(parsed, NUMERIC_DATE_TIME)
  const content = (
    <>
      Last detected <TimeAgo date={at} />
    </>
  )
  if (inline) return <span title={title}>{content}</span>
  return (
    <p className="text-xs text-muted-foreground" title={title}>
      {content}
    </p>
  )
}
