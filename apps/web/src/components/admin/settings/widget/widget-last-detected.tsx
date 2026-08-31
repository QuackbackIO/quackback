import { TimeAgo } from '@/components/ui/time-ago'

/** Relative “Last detected …” line for the widget install ping. */
export function WidgetLastDetected({ at }: { at?: string | null }) {
  if (!at) return null
  const parsed = new Date(at)
  if (Number.isNaN(parsed.getTime())) return null
  return (
    <p className="text-xs text-muted-foreground" title={parsed.toLocaleString()}>
      Last detected <TimeAgo date={at} />
    </p>
  )
}
