import { memo } from 'react'
import { Button } from '@/components/ui/button'

interface DraftBarProps {
  dirty: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
}

/**
 * Floating save bar for pages with a live preview, where changes are reviewed
 * before they apply. Every other settings page autosaves.
 */
export const DraftBar = memo(function DraftBar({
  dirty,
  saving,
  onSave,
  onDiscard,
}: DraftBarProps) {
  if (!dirty) return null
  return (
    <div
      data-slot="draft-bar"
      role="status"
      className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3.5 rounded-full bg-foreground py-2 pl-4 pr-2 text-[13.5px] text-background shadow-lg"
    >
      <span>Unsaved changes</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDiscard}
        disabled={saving}
        className="text-background/70 hover:bg-background/10 hover:text-background"
      >
        Discard
      </Button>
      <Button size="sm" onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
})
