/** The `show_reply_time` block editor: no configuration — the copy is fixed,
 *  office-hours-derived (reply-time-message.ts, server-side), so this is a
 *  preview of both variants rather than a form. */
export function ReplyTimeEditor() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Posts a quiet system-style line derived from your office hours, then continues immediately.
        No configuration — the copy is fixed:
      </p>
      <div className="space-y-2 rounded-md border bg-muted/30 p-2.5 text-xs">
        <div className="flex items-start gap-1.5">
          <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
          <span>We&rsquo;re online — typically replies in under an hour.</span>
        </div>
        <div className="flex items-start gap-1.5">
          <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
          <span>
            We&rsquo;re away right now. We&rsquo;ll get back to you as soon as we&rsquo;re back
            online.
          </span>
        </div>
      </div>
    </div>
  )
}
