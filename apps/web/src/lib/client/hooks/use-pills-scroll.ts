import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Horizontal-scroll pills with directional indicators. Returns a ref to
 * attach to the scroll container plus state flags for whether the user
 * can still scroll left or right (used to gate fade/arrow controls), and
 * a `scrollBy(delta)` helper for click-to-scroll.
 *
 * Originally extracted from the widget's board pills row; reused on the
 * public roadmap selector and anywhere a horizontal scroll-tabs pattern
 * is needed.
 */
export function usePillsScroll() {
  const ref = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const left = el.scrollLeft > 0
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setCanScrollLeft((prev) => (prev === left ? prev : left))
    setCanScrollRight((prev) => (prev === right ? prev : right))
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [update])

  const scrollBy = useCallback((delta: number) => {
    ref.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }, [])

  return { ref, canScrollLeft, canScrollRight, scrollBy }
}
