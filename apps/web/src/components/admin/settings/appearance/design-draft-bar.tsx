import { memo } from 'react'
import { Button } from '@/components/ui/button'

/**
 * The floating bar for a design draft. The draft is saved as it changes, so
 * the bar only says what is waiting and offers to discard or publish it.
 */
export const DesignDraftBar = memo(function DesignDraftBar({
  count,
  saving,
  onDiscard,
  onReview,
}: {
  count: number
  saving: boolean
  onDiscard: () => void
  onReview: () => void
}) {
  if (count === 0) return null
  return (
    <div
      data-slot="draft-bar"
      role="status"
      className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3.5 rounded-full bg-neutral-950 py-2 pl-4 pr-2 text-[13.5px] text-white shadow-lg"
    >
      <span>
        Draft · {count} {count === 1 ? 'change' : 'changes'}, not live{saving ? ' · Saving…' : ''}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDiscard}
        className="text-neutral-300 hover:bg-white/10 hover:text-white"
      >
        Discard draft
      </Button>
      <Button size="sm" onClick={onReview}>
        Review and publish
      </Button>
    </div>
  )
})
