import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Horizontal-scroll pills with directional indicators. Returns a ref for the
 * scroll container, flags for whether the user can scroll left/right (gates
 * fade/arrow controls), and a `scrollBy(delta)` helper.
 */
export function usePillsScroll() {
  const ref = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
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
