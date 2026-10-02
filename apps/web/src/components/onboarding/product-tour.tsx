import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { markTourSeenFn } from '@/lib/server/functions/onboarding-progress'
import { useFeatureFlags } from '@/lib/client/hooks/use-root-context'
import { usePermissions } from '@/lib/client/use-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'

export const TOUR_STOPS = [
  { target: 'products', message: 'Your products are here.', route: null },
  {
    target: 'feedback-empty',
    message: 'Share your board link to collect your first idea.',
    route: '/admin/feedback',
  },
  { target: 'roadmap', message: 'Move ideas along your roadmap to close the loop.', route: null },
  { target: 'view-portal', message: 'Open your portal to see what customers see.', route: null },
  { target: 'search', message: 'Search this page to find an idea.', route: '/admin/feedback' },
] as const

const TourContext = createContext<{ start: () => void } | null>(null)
export function useProductTour() {
  return useContext(TourContext)
}

export function ProductTourProvider({ children }: { children: ReactNode }) {
  const intl = useIntl()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const flags = useFeatureFlags()
  const permissions = usePermissions()
  const [index, setIndex] = useState<number | null>(null)
  const [absent, setAbsent] = useState<Set<string>>(new Set())
  const [rect, setRect] = useState<DOMRect | null>(null)
  const coachmark = useRef<HTMLDivElement>(null)
  const priorFocus = useRef<HTMLElement | null>(null)
  const direction = useRef(1)
  const stops = TOUR_STOPS.filter(
    (stop) =>
      !absent.has(stop.target) &&
      (!['feedback-empty', 'roadmap', 'search'].includes(stop.target) ||
        (flags?.feedback !== false && permissions.has(PERMISSIONS.POST_VIEW_PRIVATE)))
  )

  const restoreFocus = useCallback(() => {
    const target = priorFocus.current?.isConnected
      ? priorFocus.current
      : document.querySelector<HTMLElement>('[data-tour="view-portal"]')
    target?.focus()
  }, [])
  const finish = useCallback(() => {
    setIndex(null)
    setRect(null)
    restoreFocus()
  }, [restoreFocus])
  const move = useCallback(
    (offset: number) => {
      direction.current = offset
      setRect(null)
      setIndex((current) => {
        if (current === null) return null
        const next = current + offset
        if (next < 0 || next >= stops.length) {
          restoreFocus()
          return null
        }
        return next
      })
    },
    [stops.length, restoreFocus]
  )
  const start = useCallback(() => {
    priorFocus.current = document.activeElement as HTMLElement
    direction.current = 1
    setAbsent(new Set())
    setIndex(0)
    void markTourSeenFn()
      .then(() => queryClient.invalidateQueries({ queryKey: ['onboarding', 'progress'] }))
      .catch(() => toast.error(intl.formatMessage({ id: 'onboarding.launch.error' })))
  }, [queryClient, intl])
  const stop = index === null ? null : stops[index]

  useEffect(() => {
    if (!stop) return
    let disposed = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout>
    const findTarget = () => {
      if (disposed) return
      const target = [
        ...document.querySelectorAll<HTMLElement>(`[data-tour="${stop.target}"]`),
      ].find((element) => element.getBoundingClientRect().width > 0)
      if (target) {
        target.scrollIntoView({ block: 'nearest', behavior: 'instant' })
        setRect(target.getBoundingClientRect())
      } else if (++attempts < 20) timer = setTimeout(findTarget, 100)
      else {
        setAbsent((current) => new Set([...current, stop.target]))
        if (index !== null && index >= stops.length - 1) finish()
        else if (direction.current < 0)
          setIndex((current) => (current === null ? null : Math.max(0, current - 1)))
      }
    }
    if (stop.route) void navigate({ to: stop.route }).then(findTarget)
    else findTarget()
    const update = () => findTarget()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      disposed = true
      clearTimeout(timer)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [stop, navigate, move, index, stops.length, finish])

  useEffect(() => {
    if (rect && index !== null) coachmark.current?.focus()
  }, [rect, index])

  useEffect(() => {
    if (index === null) return
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        finish()
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        move(1)
      }
      if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault()
        move(-1)
      }
      if (event.key === 'Tab') {
        const controls =
          coachmark.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
        if (!controls?.length) return
        const first = controls[0],
          last = controls[controls.length - 1]
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === coachmark.current)
        ) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [index, finish, move])

  return (
    <TourContext.Provider value={{ start }}>
      {children}
      {stop &&
        rect &&
        index !== null &&
        createPortal(
          <div className="fixed inset-0 z-[100] [--ring:var(--muted-foreground)]">
            <div className="absolute inset-0" />
            <div
              aria-hidden="true"
              className="pointer-events-none fixed rounded-lg border-2 border-foreground shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] motion-safe:transition-all"
              style={{
                left: rect.left - 4,
                top: rect.top - 4,
                width: rect.width + 8,
                height: rect.height + 8,
              }}
            />
            <div
              ref={coachmark}
              role="dialog"
              aria-modal="true"
              aria-label={intl.formatMessage(
                { id: 'onboarding.tour.step', defaultMessage: 'Step {step} of {total}' },
                { step: index + 1, total: stops.length }
              )}
              aria-describedby="tour-copy"
              tabIndex={-1}
              className="fixed w-[min(320px,calc(100vw-32px))] rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl outline-none"
              style={{
                left: Math.max(16, Math.min(rect.right + 16, window.innerWidth - 336)),
                top: Math.max(16, Math.min(rect.top, window.innerHeight - 210)),
              }}
            >
              <p id="tour-copy" className="text-sm">
                <FormattedMessage
                  id={`onboarding.tour.${stop.target}`}
                  defaultMessage={stop.message}
                />
              </p>
              <div aria-live="polite" className="mt-4 flex items-center gap-1.5">
                {stops.map((item, i) => (
                  <span
                    key={item.target}
                    aria-hidden="true"
                    className={`h-1.5 rounded-full ${i === index ? 'w-5 bg-foreground' : 'w-1.5 bg-muted-foreground/40'}`}
                  />
                ))}
                <span className="sr-only">
                  <FormattedMessage
                    id="onboarding.tour.step"
                    defaultMessage="Step {step} of {total}"
                    values={{ step: index + 1, total: stops.length }}
                  />
                </span>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={finish}>
                  <FormattedMessage id="onboarding.tour.skip" defaultMessage="Skip" />
                </Button>
                <div className="flex-1" />
                <Button variant="outline" size="sm" disabled={index === 0} onClick={() => move(-1)}>
                  <FormattedMessage id="onboarding.tour.back" defaultMessage="Back" />
                </Button>
                <Button size="sm" onClick={() => move(1)}>
                  <FormattedMessage
                    id={
                      index === stops.length - 1 ? 'onboarding.tour.finish' : 'onboarding.tour.next'
                    }
                    defaultMessage={index === stops.length - 1 ? 'Finish' : 'Next'}
                  />
                </Button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </TourContext.Provider>
  )
}
