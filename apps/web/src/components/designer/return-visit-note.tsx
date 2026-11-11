import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { LocalDate } from '@/components/ui/local-date'
import { staleDraftSince } from '@/lib/shared/design/draft-age'

/**
 * A quiet note on coming back to an old draft: when it is from, and whether
 * to keep it or start again from what visitors see.
 */
export function ReturnVisitNote({
  savedAt,
  now,
  onDiscard,
}: {
  /** When the draft was last saved, or null without one. */
  savedAt: string | null
  now: Date
  onDiscard: () => void
}) {
  const [kept, setKept] = useState(false)
  const since = staleDraftSince(savedAt, now)
  if (!since || kept) return null
  const sameYear = since.getFullYear() === now.getFullYear()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted px-3 py-2 text-ui">
      <p className="me-auto">
        Your draft is from{' '}
        <LocalDate
          date={since}
          locale="en-GB"
          options={{ day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) }}
        />
        .
      </p>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          Discard
        </Button>
        <Button variant="outline" size="sm" onClick={() => setKept(true)}>
          Keep
        </Button>
      </div>
    </div>
  )
}
