import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/shared/utils'

interface ExpandableQuoteProps {
  text: string
  /** Additional classes for the text paragraph (e.g. border-l for quote styling) */
  className?: string
}

/**
 * Text that collapses to 2 lines with a "Show full message" / "Show less" toggle.
 * Used for feedback quotes in suggestion triage and the create-from-suggestion dialog.
 */
export function ExpandableQuote({ text, className }: ExpandableQuoteProps) {
  const [expanded, setExpanded] = useState(false)
  const [isClamped, setIsClamped] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) setIsClamped(el.scrollHeight > el.clientHeight + 1)
  }, [text])

  const base = cn('text-xs text-muted-foreground/70 leading-relaxed whitespace-pre-wrap', className)

  if (expanded) {
    return (
      <div>
        <div className="max-h-56 overflow-y-auto overscroll-contain scrollbar-thin">
          <p className={base}>{text}</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground mt-0.5 cursor-pointer"
        >
          Show less
        </button>
      </div>
    )
  }

  return (
    <div>
      <p ref={ref} className={cn(base, 'line-clamp-2')}>
        {text}
      </p>
      {isClamped && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground mt-0.5 cursor-pointer"
        >
          Show full message
        </button>
      )}
    </div>
  )
}
