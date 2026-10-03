import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from '@tanstack/react-router'
import { FormattedMessage, IntlProvider, useIntl } from 'react-intl'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { getTourContextFn, markTourSeenFn } from '@/lib/server/functions/onboarding-progress'
import { useFeatureFlags } from '@/lib/client/hooks/use-root-context'
import { usePermissions } from '@/lib/client/use-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { cn } from '@/lib/shared/utils'
import { DEFAULT_LOCALE, isTourMessage, loadTourMessages, normalizeLocale } from '@/lib/shared/i18n'
import type { TourEndAction } from './product-tour'
import {
  placeCoachmark,
  resolveTourStops,
  type TourContext,
  type TourRoute,
  type TourStop,
} from './tour-stops'

/** Below the `sm` breakpoint the sidebar is behind the menu drawer. */
const NARROW_QUERY = '(max-width: 639px)'
const CARD_FALLBACK = { width: 340, height: 152 }
/** How long a stop on a page that just opened waits for its element to render. */
const TARGET_WAIT_MS = 1500

function visibleTarget(target: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)) {
    if (element.getBoundingClientRect().width > 0) return element
  }
  return null
}

/** Resolve once the element is in the page, watching for it rather than polling. */
function waitForTarget(target: string): Promise<HTMLElement | null> {
  const present = visibleTarget(target)
  if (present) return Promise.resolve(present)
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const element = visibleTarget(target)
      if (element) finish(element)
    })
    const timer = setTimeout(() => finish(null), TARGET_WAIT_MS)
    function finish(element: HTMLElement | null) {
      observer.disconnect()
      clearTimeout(timer)
      resolve(element)
    }
    observer.observe(document.body, { childList: true, subtree: true })
  })
}

/** An empty state that has not rendered falls back to its product's sidebar item. */
function fallbackTarget(target: string): string | null {
  return target.endsWith('-empty') ? `nav-${target.replace(/-empty$/, '')}` : null
}

type Phase = 'idle' | 'tour' | 'end'

/**
 * The overlay's strings, which admin pages leave out of the catalog they seed.
 * A catalog that already holds them (one loaded whole, say) needs nothing more.
 */
function tourMessagesFor(messages: Record<string, unknown>, locale: string) {
  if (Object.keys(messages).some(isTourMessage)) return Promise.resolve({})
  return loadTourMessages(normalizeLocale(locale) ?? DEFAULT_LOCALE).catch(() => ({}))
}

/**
 * The tour itself: the stops, the coachmark and the end card. It loads the
 * first time a tour starts, and starts a tour each time `runId` changes.
 */
export function ProductTourRunner({
  runId,
  copilotOnHome = false,
  endAction,
}: {
  runId: number
  /** Home leads with the Copilot chat, so the tour opens on it. */
  copilotOnHome?: boolean
  endAction?: TourEndAction
}) {
  const intl = useIntl()
  const router = useRouter()
  const queryClient = useQueryClient()
  const flags = useFeatureFlags()
  const permissions = usePermissions()
  const [phase, setPhase] = useState<Phase>('idle')
  const [stops, setStops] = useState<TourStop[]>([])
  const [index, setIndex] = useState(0)
  const [context, setContext] = useState<Pick<TourContext, 'goals' | 'feedbackPrivate'> | null>(
    null
  )
  const [tourMessages, setTourMessages] = useState<Record<string, string>>({})
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [located, setLocated] = useState(false)
  const [cardSize, setCardSize] = useState(CARD_FALLBACK)
  const coachmark = useRef<HTMLDivElement>(null)
  const endCard = useRef<HTMLDivElement>(null)
  const priorFocus = useRef<HTMLElement | null>(null)
  const starting = useRef(false)

  const goTo = useCallback(
    async (route: TourRoute) => {
      if (router.state.location.pathname !== route) await router.navigate({ to: route })
    },
    [router]
  )

  const restoreFocus = useCallback(() => {
    const previous = priorFocus.current
    if (previous?.isConnected) previous.focus()
  }, [])

  const close = useCallback(() => {
    setPhase('idle')
    setTargetElement(null)
    setRect(null)
    setLocated(false)
    restoreFocus()
  }, [restoreFocus])

  const start = useCallback(async () => {
    if (starting.current) return
    starting.current = true
    priorFocus.current = document.activeElement as HTMLElement | null
    try {
      const [fetched, loadedMessages] = await Promise.all([
        getTourContextFn().catch(() => null),
        tourMessagesFor(intl.messages, intl.locale),
      ])
      const tourContext: TourContext = {
        copilotOnHome,
        goals: fetched?.goals ?? ['product_feedback'],
        feedbackPrivate: fetched?.feedbackPrivate ?? false,
        modules: {
          feedback: isProductEnabled(flags, 'feedback'),
          support: isProductEnabled(flags, 'support'),
          helpCenter: isProductEnabled(flags, 'helpCenter'),
          status: isProductEnabled(flags, 'status'),
        },
        permissions,
        narrow: window.matchMedia?.(NARROW_QUERY).matches ?? false,
        empty: fetched?.empty ?? {
          feedback: false,
          support: false,
          helpCenter: false,
          status: false,
        },
      }
      const resolved = resolveTourStops(tourContext)
      if (resolved.length === 0) return
      if (permissions.has(PERMISSIONS.MEMBER_VIEW)) {
        // Seen is a convenience marker: a failed write only means the offer returns.
        void markTourSeenFn()
          .then(() => queryClient.invalidateQueries({ queryKey: ['onboarding', 'progress'] }))
          .catch(() => undefined)
      }
      setTourMessages((current) => ({ ...current, ...loadedMessages }))
      setContext({ goals: tourContext.goals, feedbackPrivate: tourContext.feedbackPrivate })
      setStops(resolved)
      setIndex(0)
      setLocated(false)
      setPhase('tour')
    } finally {
      starting.current = false
    }
  }, [copilotOnHome, flags, permissions, queryClient, intl.messages, intl.locale])

  const finish = useCallback(async () => {
    setTargetElement(null)
    setRect(null)
    setLocated(false)
    await goTo('/admin')
    setPhase('end')
  }, [goTo])

  const move = useCallback(
    (offset: number) => {
      const next = index + offset
      if (next < 0) return
      if (next >= stops.length) {
        void finish()
        return
      }
      setLocated(false)
      setTargetElement(null)
      setRect(null)
      setIndex(next)
    },
    [index, stops.length, finish]
  )

  const stop = phase === 'tour' ? stops[index] : undefined

  // Open the stop's page, then point at its element once it is there.
  useEffect(() => {
    if (!stop) return
    let disposed = false
    void (async () => {
      if (stop.route) await goTo(stop.route)
      let element = await waitForTarget(stop.target)
      const fallback = element ? null : fallbackTarget(stop.target)
      if (!element && fallback) element = visibleTarget(fallback)
      if (disposed) return
      if (element) {
        element.scrollIntoView({ block: 'nearest' })
        setTargetElement(element)
        setRect(element.getBoundingClientRect())
      }
      setLocated(true)
    })()
    return () => {
      disposed = true
    }
  }, [stop, goTo])

  // Follow the element when the page scrolls or resizes.
  useEffect(() => {
    if (!targetElement) return
    const update = () => setRect(targetElement.getBoundingClientRect())
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [targetElement])

  useLayoutEffect(() => {
    const card = coachmark.current
    if (!card || !located) return
    const next = { width: card.offsetWidth || CARD_FALLBACK.width, height: card.offsetHeight }
    if (next.height && (next.width !== cardSize.width || next.height !== cardSize.height)) {
      setCardSize(next)
    }
  }, [located, index, cardSize])

  useEffect(() => {
    if (phase === 'tour' && located) coachmark.current?.focus()
    if (phase === 'end') endCard.current?.querySelector<HTMLElement>('button')?.focus()
  }, [phase, located, index])

  useEffect(() => {
    if (phase === 'idle') return
    const container = phase === 'tour' ? coachmark : endCard
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (phase === 'tour' && event.key === 'ArrowRight') {
        event.preventDefault()
        move(1)
      } else if (phase === 'tour' && event.key === 'ArrowLeft') {
        event.preventDefault()
        move(-1)
      } else if (event.key === 'Tab') {
        const controls = container.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href]'
        )
        if (!controls?.length) return
        const first = controls[0]!
        const last = controls[controls.length - 1]!
        const active = document.activeElement
        if (event.shiftKey && (active === first || active === container.current)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        } else if (!container.current?.contains(active)) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [phase, move, close])

  // Each start request from the provider runs the tour from the top. Only the
  // request starts it, so the latest `start` is read through a ref.
  const startRef = useRef(start)
  useLayoutEffect(() => {
    startRef.current = start
  })
  useEffect(() => {
    void startRef.current()
  }, [runId])
  const shortcut = useMemo(
    () =>
      typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
        ? 'Cmd K'
        : 'Ctrl K',
    []
  )

  const placement =
    rect && typeof window !== 'undefined'
      ? placeCoachmark(rect, cardSize, { width: window.innerWidth, height: window.innerHeight })
      : null
  const last = index === stops.length - 1

  // The app's catalogs are plain strings, never precompiled messages.
  const pageMessages = intl.messages as Record<string, string>
  const overlayMessages = useMemo(
    () => ({ ...pageMessages, ...tourMessages }),
    [pageMessages, tourMessages]
  )

  const overlay = (
    <>
      {phase === 'tour' &&
        stop &&
        createPortal(
          <div className="fixed inset-0 z-[100] [--ring:var(--muted-foreground)]">
            <div className={cn('absolute inset-0', !rect && 'bg-black/55')} />
            {rect && (
              <div
                aria-hidden="true"
                className="pointer-events-none fixed rounded-xl border-2 border-white shadow-[0_0_0_9999px_rgba(9,9,11,0.58)] motion-safe:transition-all motion-safe:duration-200"
                style={{
                  left: rect.left - 4,
                  top: rect.top - 4,
                  width: rect.width + 8,
                  height: rect.height + 8,
                }}
              />
            )}
            {located && (
              <div
                ref={coachmark}
                role="dialog"
                aria-modal="true"
                aria-labelledby="tour-stop-lead tour-stop-count"
                aria-describedby="tour-stop-line"
                tabIndex={-1}
                data-side={placement?.side ?? 'center'}
                className="fixed w-[min(340px,calc(100vw-32px))] rounded-xl border bg-popover px-4 pb-3.5 pt-4 text-popover-foreground shadow-xl outline-none"
                style={
                  placement
                    ? { left: placement.left, top: placement.top }
                    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
                }
              >
                {placement && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute size-3.5 rotate-45 bg-popover',
                      placement.side === 'right' && '-left-[7px] border-b border-l',
                      placement.side === 'left' && '-right-[7px] border-r border-t',
                      placement.side === 'bottom' && '-top-[7px] border-l border-t',
                      placement.side === 'top' && '-bottom-[7px] border-b border-r'
                    )}
                    style={
                      placement.side === 'right' || placement.side === 'left'
                        ? { top: placement.arrow - 7 }
                        : { left: placement.arrow - 7 }
                    }
                  />
                )}
                <p className="relative text-sm leading-relaxed">
                  <strong id="tour-stop-lead" className="font-semibold">
                    <FormattedMessage {...stop.lead} />
                  </strong>{' '}
                  <span id="tour-stop-line">
                    <FormattedMessage {...stop.line} values={{ shortcut }} />
                  </span>
                </p>
                <div className="relative mt-3.5 flex items-center gap-1.5">
                  <span id="tour-stop-count" className="me-auto text-xs text-muted-foreground">
                    <FormattedMessage
                      id="onboarding.tour.count"
                      defaultMessage="{step} of {total}"
                      values={{ step: index + 1, total: stops.length }}
                    />
                  </span>
                  <Button variant="ghost" size="sm" onClick={close}>
                    <FormattedMessage id="onboarding.tour.skipTour" defaultMessage="Skip tour" />
                  </Button>
                  {index > 0 && (
                    <Button variant="outline" size="sm" onClick={() => move(-1)}>
                      <FormattedMessage id="onboarding.tour.back" defaultMessage="Back" />
                    </Button>
                  )}
                  <Button size="sm" onClick={() => move(1)}>
                    {last ? (
                      <FormattedMessage id="onboarding.tour.finish" defaultMessage="Finish" />
                    ) : (
                      <FormattedMessage id="onboarding.tour.next" defaultMessage="Next" />
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>,
          document.body
        )}
      {phase === 'end' &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 [--ring:var(--muted-foreground)]">
            <div
              ref={endCard}
              role="dialog"
              aria-modal="true"
              aria-labelledby="tour-end-title"
              className="flex w-full max-w-[420px] flex-col gap-2.5 rounded-2xl border bg-popover p-6 text-popover-foreground shadow-xl"
            >
              <h2 id="tour-end-title" className="text-xl font-semibold">
                <FormattedMessage id="onboarding.tour.end.title" defaultMessage="That's the tour" />
              </h2>
              <p className="text-sm text-muted-foreground">
                <FormattedMessage
                  id="onboarding.tour.end.replay"
                  defaultMessage="Replay it any time from Help."
                />
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {endAction && context ? endAction({ ...context, close }) : null}
                <Button variant="outline" onClick={close}>
                  <FormattedMessage id="onboarding.tour.end.done" defaultMessage="Done" />
                </Button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )

  if (phase === 'idle') return null
  return (
    <IntlProvider
      locale={intl.locale}
      defaultLocale={intl.defaultLocale}
      messages={overlayMessages}
      onError={intl.onError}
    >
      {overlay}
    </IntlProvider>
  )
}
