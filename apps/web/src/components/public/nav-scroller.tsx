import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronRightIcon } from '@heroicons/react/20/solid'
import { cn } from '@/lib/shared/utils'

/**
 * A menu row that scrolls when it is wider than the screen. An edge with more
 * of the menu beyond it fades, and the end with more shows a chevron that
 * scrolls the menu on, so a visitor can see there is more; the current page
 * scrolls into view. The marks are set on the element, so scrolling never
 * re-renders.
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
  const scrollOn = () => {
    const row = ref.current
    if (!row) return
    const ahead = getComputedStyle(row).direction === 'rtl' ? -1 : 1
    row.scrollBy({ left: ahead * row.clientWidth * 0.6, behavior: 'smooth' })
  }
  return (
    <div className={cn('relative', className)}>
      <div
        ref={ref}
        data-qb-nav-row=""
        className={cn(
          // The end fades out before the chevron, so the last word dissolves rather than stops.
          'overflow-x-auto scrollbar-none qb-nav-fade'
        )}
      >
        {children}
      </div>
      {/* A pointer's way on: the menu's links are reachable by keyboard already. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        data-qb-nav-more=""
        onClick={scrollOn}
        className="absolute inset-y-0 end-0 hidden min-h-6 w-6 items-center justify-center text-[var(--header-foreground,currentColor)] [[data-more-end]+&]:flex"
      >
        <ChevronRightIcon className="size-4 rtl:rotate-180" />
      </button>
    </div>
  )
}
