import { useEffect, useRef } from 'react'

interface FeedbackSidebarProps {
  /** The filter panel. */
  children: React.ReactNode
  /** Pinned under the panel, outside its scroll area, so it stays in view. */
  footer?: React.ReactNode
}

/** Gap kept between the column and the viewport's bottom edge. */
const EDGE = 24
/**
 * Where the column sits below the header at the top of the page: the page's
 * top padding (py-6). It sticks at the same spot, so it never moves while the
 * page scrolls under it.
 */
const STICK_GAP = 24

/** The portal's sticky header height, which the column sticks below. */
function headerHeight(): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    '--portal-header-height'
  )
  return parseFloat(value) || 0
}

export function FeedbackSidebar({ children, footer }: FeedbackSidebarProps) {
  const columnRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // The column fills the space from where it sits down to the viewport's
  // bottom edge: below the portal header at the top of the page, and below
  // the sticky header once it sticks. The panel scrolls inside it and the footer stays
  // in view throughout.
  useEffect(() => {
    const column = columnRef.current
    if (!column) return
    let frame = 0
    const fit = () => {
      frame = 0
      const top = Math.max(headerHeight() + STICK_GAP, column.getBoundingClientRect().top)
      column.style.maxHeight = `${window.innerHeight - top - EDGE}px`
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit)
    }
    fit()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    // The header can change height after mount (a late font, custom CSS),
    // which moves where the column sticks.
    const header = document.querySelector('.portal-header')
    const observer = new ResizeObserver(schedule)
    if (header) observer.observe(header)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer.disconnect()
    }
  }, [])

  // While more of the panel sits below its fold, its foot fades out as a cue
  // to scroll. Set on the element directly so scrolling never re-renders.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const update = () => {
      panel.toggleAttribute(
        'data-more-below',
        panel.scrollTop + panel.clientHeight < panel.scrollHeight - 1
      )
    }
    update()
    panel.addEventListener('scroll', update, { passive: true })
    // The panel resizes with the column, and its content grows when a
    // section unfolds.
    const observer = new ResizeObserver(update)
    observer.observe(panel)
    if (panel.firstElementChild) observer.observe(panel.firstElementChild)
    return () => {
      panel.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [])

  return (
    <aside className="hidden w-72 shrink-0 lg:block xl:w-80">
      <div
        ref={columnRef}
        className="sticky top-[calc(var(--portal-header-height,0px)+1.5rem)] flex max-h-[calc(100vh-3rem)] flex-col gap-3"
      >
        <div
          ref={panelRef}
          className="min-h-0 overflow-y-auto scrollbar-thin rounded-lg border border-border/50 bg-card shadow-sm data-more-below:[mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)]"
        >
          {children}
        </div>
        {footer && <div className="shrink-0">{footer}</div>}
      </div>
    </aside>
  )
}
