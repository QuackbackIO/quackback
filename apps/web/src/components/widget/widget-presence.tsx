import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { cn } from '@/lib/shared/utils'

/**
 * The widget's small replacement for framer-motion's `AnimatePresence`, so the
 * embeddable widget ships no animation library: enter animations are CSS
 * (tw-animate-css `animate-in`), and exits use the Web Animations API here.
 *
 * Keeps an element mounted after `show` turns false until its exit animation
 * finishes. Render the element while `mounted` is true and attach `ref` to it.
 * `exit` starts the exit animation and returns it, or returns null to remove
 * the element at once. Removal is also immediate when the browser has no
 * `Element.animate` (jsdom) or the visitor prefers reduced motion. If `show`
 * turns true again mid-exit, the exit is cancelled and the element stays.
 */
export function usePresence<T extends HTMLElement>(
  show: boolean,
  exit: (el: T) => Animation | null
): { mounted: boolean; ref: RefObject<T | null> } {
  const [mounted, setMounted] = useState(show)
  const ref = useRef<T>(null)
  const exitRef = useRef(exit)
  useLayoutEffect(() => {
    exitRef.current = exit
  })
  useLayoutEffect(() => {
    if (show) {
      setMounted(true)
      return
    }
    const el = ref.current
    const animation =
      el && typeof el.animate === 'function' && !prefersReducedMotion() ? exitRef.current(el) : null
    if (!animation) {
      setMounted(false)
      return
    }
    let live = true
    animation.finished.then(
      () => {
        if (live) setMounted(false)
      },
      () => {}
    )
    return () => {
      live = false
      animation.cancel()
    }
  }, [show])
  return { mounted: show || mounted, ref }
}

/**
 * Animates an element that has just mounted from height 0 (and transparent)
 * to its natural height, then hands the height back to CSS (`auto`), the way
 * framer-motion's `height: 'auto'` does. Runs before paint, so the element
 * never shows at full height first. A no-op without `Element.animate` or
 * under reduced motion.
 */
export function useHeightEnter<T extends HTMLElement>(
  ref: RefObject<T | null>,
  timing: { duration: number; easing: string }
): void {
  const { duration, easing } = timing
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof el.animate !== 'function' || prefersReducedMotion()) return
    el.animate(
      [
        { height: '0px', opacity: 0 },
        { height: `${el.scrollHeight}px`, opacity: 1 },
      ],
      { duration, easing }
    )
    // Callers pass constant timings, so this runs once per mount.
  }, [ref, duration, easing])
}

/** The exit that pairs with {@link useHeightEnter}: collapse and fade out. */
export function heightExit(el: HTMLElement, timing: { duration: number; easing: string }) {
  return el.animate(
    [
      { height: `${el.offsetHeight}px`, opacity: getComputedStyle(el).opacity },
      { height: '0px', opacity: 0 },
    ],
    { ...timing, fill: 'forwards' }
  )
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * framer-motion's named easings as CSS, for exits run through the Web
 * Animations API. framer's `easeInOut` (its default for a tween) is CSS's
 * `ease-in-out`, not Tailwind's `ease-in-out` utility, which is a different
 * curve.
 */
export const EASE = {
  easeIn: 'cubic-bezier(0.42, 0, 1, 1)',
  easeOut: 'cubic-bezier(0, 0, 0.58, 1)',
  easeInOut: 'cubic-bezier(0.42, 0, 0.58, 1)',
} as const

/**
 * A block that grows open from height 0 when `show` turns true and collapses
 * back when it turns false: framer-motion's
 * `initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
 * exit={{ height: 0, opacity: 0 }}` inside `AnimatePresence`. Clips its
 * content while it moves. Like `AnimatePresence`, it keeps showing the
 * content it last had while visible until the exit ends, so a caller can
 * clear the data behind it in the same update that hides it.
 */
export function HeightPresence({
  show,
  duration,
  easing,
  className,
  children,
}: {
  show: boolean
  duration: number
  easing: string
  className?: string
  children: ReactNode
}) {
  const presence = usePresence<HTMLDivElement>(show, (el) => heightExit(el, { duration, easing }))
  const lastShown = useRef(children)
  useLayoutEffect(() => {
    if (show) lastShown.current = children
  })
  if (!presence.mounted) return null
  return (
    <HeightEnter elRef={presence.ref} duration={duration} easing={easing} className={className}>
      {show ? children : lastShown.current}
    </HeightEnter>
  )
}

function HeightEnter({
  elRef,
  duration,
  easing,
  className,
  children,
}: {
  elRef: RefObject<HTMLDivElement | null>
  duration: number
  easing: string
  className?: string
  children: ReactNode
}) {
  useHeightEnter(elRef, { duration, easing })
  return (
    <div ref={elRef} className={cn('overflow-hidden', className)}>
      {children}
    </div>
  )
}
