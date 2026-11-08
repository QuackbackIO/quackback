import { Button } from '@/components/ui/button'
import { TimeAgo } from '@/components/ui/time-ago'
import type { useDesignDraft } from './use-design-draft'

type Draft = ReturnType<typeof useDesignDraft>

/** Who moved the draft on, what they did, and when: "Sam saved the draft 2 minutes ago." */
function ConflictHeadline({ change }: { change: Draft['conflictChange'] }) {
  if (!change) return <>Someone else changed the draft.</>
  const what =
    change.kind === 'published'
      ? 'published a version'
      : change.by === 'You'
        ? 'saved the draft somewhere else'
        : 'saved the draft'
  return (
    <>
      {change.by} {what} <TimeAgo date={change.at} locale="en" />.
    </>
  )
}

/**
 * What stops the draft from saving: a colleague's newer draft, which the
 * person chooses to load or to overwrite, or a change the server refused,
 * with a way back to the draft it last saved.
 */
export function DraftNotices({ draft }: { draft: Draft }) {
  return (
    <>
      {draft.conflict && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-[13px] text-foreground"
        >
          <p>
            <span className="font-medium">
              <ConflictHeadline change={draft.conflictChange} />
            </span>{' '}
            Those changes aren't in what you see, and yours won't save until you choose.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void draft.loadTheirs()}>
              Load their changes
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void draft.keepMine()}>
              Keep mine (replaces theirs)
            </Button>
          </div>
        </div>
      )}
      {draft.refusal && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-[13px] text-destructive"
        >
          <p>{draft.refusal}</p>
          <Button size="sm" variant="outline" onClick={() => draft.recover()}>
            Back to last saved
          </Button>
        </div>
      )}
    </>
  )
}
