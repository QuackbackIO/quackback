import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/shared/utils'

/**
 * A menu row that scrolls when it is wider than the screen. An edge with more
 * of the menu beyond it fades, so a visitor can see there is more, and the
 * current page scrolls into view. The marks are set on the element, so
 * scrolling never re-renders.
 */
export function NavScroller({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = ref.current
    if (!row) return
    const update = () => {
      // scrollLeft runs negative in a right-to-left page.
      const scrolled = Math.abs(row.scrollLeft)
      row.toggleAttribute('data-more-start', scrolled > 1)
      row.toggleAttribute('data-more-end', scrolled + row.clientWidth < row.scrollWidth - 1)
    }
    const current = row.querySelector<HTMLElement>('[aria-current=page]')
    if (current && row.scrollWidth > row.clientWidth)
      row.scrollLeft += current.getBoundingClientRect().left - row.getBoundingClientRect().left - 16
    update()
    row.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(row)
    if (row.firstElementChild) observer.observe(row.firstElementChild)
    return () => {
      row.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [])
  return (
    <div
      ref={ref}
      data-qb-nav-row=""
      className={cn(
        'overflow-x-auto scrollbar-none',
        'data-more-end:[mask-image:linear-gradient(to_right,black_calc(100%-3rem),transparent)]',
        'data-more-start:[mask-image:linear-gradient(to_left,black_calc(100%-3rem),transparent)]',
        'data-more-start:data-more-end:[mask-image:linear-gradient(to_right,transparent,black_3rem,black_calc(100%-3rem),transparent)]',
        className
      )}
    >
      {children}
    </div>
  )
}
