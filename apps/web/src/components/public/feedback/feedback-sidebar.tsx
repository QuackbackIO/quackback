import { useEffect, useRef } from 'react'

interface FeedbackSidebarProps {
  /** The filter panel. */
  children: React.ReactNode
  /** Pinned under the panel, outside its scroll area, so it stays in view. */
  footer?: React.ReactNode
}

/** Gap kept between the column and the viewport edges. */
const EDGE = 24

export function FeedbackSidebar({ children, footer }: FeedbackSidebarProps) {
  const columnRef = useRef<HTMLDivElement>(null)

  // The column fills the space from where it sits down to the viewport's
  // bottom edge: below the portal header at the top of the page, the full
  // height once it sticks. The panel scrolls inside it and the footer stays
  // in view throughout.
  useEffect(() => {
    const column = columnRef.current
    if (!column) return
    let frame = 0
    const fit = () => {
      frame = 0
      const top = Math.max(EDGE, column.getBoundingClientRect().top)
      column.style.maxHeight = `${window.innerHeight - top - EDGE}px`
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit)
    }
    fit()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [])

  return (
    <aside className="hidden md:block w-56 lg:w-64 shrink-0">
      <div ref={columnRef} className="sticky top-6 flex max-h-[calc(100vh-3rem)] flex-col gap-3">
        <div className="min-h-0 overflow-y-auto scrollbar-thin rounded-lg border border-border/50 bg-card shadow-sm">
          {children}
        </div>
        {footer && <div className="shrink-0">{footer}</div>}
      </div>
    </aside>
  )
}
