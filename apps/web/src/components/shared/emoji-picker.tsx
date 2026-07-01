import { useState } from 'react'
import { FaceSmileIcon } from '@heroicons/react/24/outline'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/shared/utils'

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
 * after a pick.
 */
export function EmojiPicker({
  onSelect,
  className,
}: {
  onSelect: (emoji: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)

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
        <div className="grid grid-cols-8 gap-0.5">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onSelect(emoji)
                setOpen(false)
              }}
              className="flex size-7 items-center justify-center rounded text-lg leading-none hover:bg-muted"
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
