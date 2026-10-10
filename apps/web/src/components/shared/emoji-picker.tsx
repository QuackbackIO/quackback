import { useEffect, useState } from 'react'
import { FaceSmileIcon } from '@heroicons/react/24/outline'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/shared/utils'
import { readRecentEmojis, recordRecentEmoji } from '@/lib/shared/emoji-recommendations'

// A small curated set keeps this dependency-free; covers the common conversation range.
const EMOJIS = [
  '😀',
  '😁',
  '😂',
  '🤣',
  '😊',
  '😍',
  '😎',
  '🤔',
  '😅',
  '🙂',
  '😉',
  '😇',
  '🥳',
  '😴',
  '😢',
  '😭',
  '😡',
  '🤯',
  '👍',
  '👎',
  '👏',
  '🙌',
  '🙏',
  '🤞',
  '🤝',
  '💪',
  '👀',
  '🎉',
  '🔥',
  '💯',
  '✅',
  '❌',
  '⚠️',
  '❤️',
  '💔',
  '💡',
  '🚀',
  '⭐',
  '🐛',
  '📎',
  '🤷',
]

/**
 * Emoji inserter: a toggle button with a popover grid. Uses the shared shadcn
 * Popover (portaled + auto-positioned, same as the comment reaction picker) so
 * it lays out correctly everywhere, including inside the widget iframe. Closes
 * after a pick. Recently used glyphs sit in a Slack/WhatsApp-style row above
 * the curated popular set.
 */
export function EmojiPicker({
  onSelect,
  className,
}: {
  onSelect: (emoji: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [recents, setRecents] = useState<string[]>([])

  useEffect(() => {
    if (open) setRecents(readRecentEmojis())
  }, [open])

  const pick = (emoji: string) => {
    recordRecentEmoji(emoji)
    onSelect(emoji)
    setOpen(false)
  }

  const recentRow = recents
  const popular = EMOJIS.filter((glyph) => !recentRow.includes(glyph))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted',
            className
          )}
          aria-label="Insert emoji"
        >
          <FaceSmileIcon className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-1.5">
        {recentRow.length > 0 && (
          <div className="mb-1">
            <div className="px-0.5 pb-0.5 text-xs font-medium text-muted-foreground">Recent</div>
            <div className="grid grid-cols-8 gap-0.5">
              {recentRow.map((emoji) => (
                <EmojiCell key={`recent-${emoji}`} emoji={emoji} onPick={pick} />
              ))}
            </div>
          </div>
        )}
        <div>
          {recentRow.length > 0 && (
            <div className="px-0.5 pb-0.5 text-xs font-medium text-muted-foreground">Popular</div>
          )}
          <div className="grid grid-cols-8 gap-0.5">
            {popular.map((emoji) => (
              <EmojiCell key={emoji} emoji={emoji} onPick={pick} />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function EmojiCell({ emoji, onPick }: { emoji: string; onPick: (emoji: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(emoji)}
      className="flex size-7 items-center justify-center rounded text-lg leading-none hover:bg-muted"
    >
      {emoji}
    </button>
  )
}
