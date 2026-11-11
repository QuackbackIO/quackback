/**
 * Compare looks: Matched, Soft and Vivid of the brand, as live Home pages,
 * side by side or one at a time, over the canvas and Ask AI while it is open.
 * The settings stay beside it. Picking a look only shows it; "Use" takes it
 * into the draft as one step, with Undo in a toast, and the draft's own
 * pages, menu and words stay. Loaded only once it opens.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RectangleGroupIcon, ViewColumnsIcon } from '@heroicons/react/24/outline'
import type { DesignAiTurn } from '@/components/admin/settings/appearance/use-design-ai'
import { Button } from '@/components/ui/button'
import type { LookDevice, LookZoom, LooksView } from '@/lib/shared/design/compare-looks'
import type { LookVariant, LookVariantId } from '@/lib/shared/design/look-variants'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { cn } from '@/lib/shared/utils'
import { LookFrame } from './look-frame'
import type { LooksFrom } from './looks-entry'
// Only types and the kit from the builder: an import of its modules would split them out.
import type { LooksKit } from './looks-kit'

type Update = (change: (draft: PortalDesign) => void, label?: string) => void

/** The chooser's own zoom, kept while the builder is open, apart from the canvas's. */
let keptZoom: LookZoom = 'fit'

const GAP = 16

const VIEWS: Array<readonly [LooksView, string, typeof ViewColumnsIcon]> = [
  ['side', 'Side by side', ViewColumnsIcon],
  ['one', 'One at a time', RectangleGroupIcon],
]

/** A preview box's size, measured. */
type Box = { width: number; height: number }

export function LooksChooser({
  kit,
  design,
  from,
  device,
  onDevice,
  theme,
  locale,
  update,
  undoStep,
  record,
  onClose,
}: {
  /** What it takes from the builder (see looks-kit.ts). */
  kit: LooksKit
  /** The draft as it is. */
  design: PortalDesign
  from: LooksFrom
  /** The canvas's device, which the chooser shows and sets, as the top bar's switch does. */
  device: LookDevice
  onDevice: (device: LookDevice) => void
  /** The canvas's light or dark, for a design that follows the visitor's. */
  theme: 'light' | 'dark'
  locale: string
  update: Update
  /** Undoes the step named, if it is still the last; false when it is not. */
  undoStep: (label: string) => boolean
  /** Says in Ask AI that a look was taken, opened from there or from onboarding's match. */
  record?: (turn: DesignAiTurn) => void
  onClose: () => void
}) {
  const {
    DeviceToggle,
    ZoomControl,
    onRadioKeys,
    LOOK_HINTS,
    LOOK_NAMES,
    LOOK_ORDER,
    LOOK_WIDTHS,
  } = kit
  // The design the looks are made from, as the chooser opens: the last brand match, else the draft.
  const [base] = useState(() => kit.lookBase(design))
  const variants = useMemo(() => kit.lookVariants(base), [kit, base])
  const inUse = useMemo(() => kit.currentVariant(design, base), [kit, design, base])
  const [picked, setPicked] = useState<LookVariantId>(inUse ?? 'matched')
  const [asked, setAsked] = useState<LooksView>('side')
  const viewport = kit.useViewportWidth()
  const view = kit.shownView(asked, viewport)
  const [zoom, setZoomState] = useState<LookZoom>(keptZoom)
  const setZoom = (next: LookZoom) => {
    keptZoom = next
    setZoomState(next)
  }
  const width = LOOK_WIDTHS[device]

  // Each look as the draft would have it: its own pages, menu and words.
  const shown = useMemo(
    () =>
      variants.map((variant) => ({ ...variant, design: kit.applyLookVariant(design, variant) })),
    [variants, design, kit]
  )

  // The preview boxes, measured; all three are one size.
  const [box, setBox] = useState<Box>({ width: 0, height: 0 })
  const boxes = useRef(new Map<LookVariantId, HTMLDivElement>())
  const observer = useRef<ResizeObserver | null>(null)
  useLayoutEffect(() => {
    const measure = (element: Element) => {
      const { width: w, height: h } = element.getBoundingClientRect()
      if (w > 0)
        setBox((was) => (was.width === w && was.height === h ? was : { width: w, height: h }))
    }
    const watch = new ResizeObserver((entries) => {
      for (const entry of entries) measure(entry.target)
    })
    observer.current = watch
    for (const element of boxes.current.values()) {
      // A box mid-swap may not be an element the browser will watch.
      if (!(element instanceof Element)) continue
      measure(element)
      try {
        watch.observe(element)
      } catch {
        // Measured once; not watched.
      }
    }
    return () => watch.disconnect()
  }, [])
  const boxRef = (id: LookVariantId) => (element: HTMLDivElement | null) => {
    if (element) boxes.current.set(id, element)
    else boxes.current.delete(id)
  }

  // The looks scroll together, so each shows the same part of the page.
  const frames = useRef(new Map<LookVariantId, HTMLIFrameElement>())
  const syncing = useRef(false)
  const scrolled = useCallback((id: LookVariantId, top: number) => {
    if (syncing.current) return
    syncing.current = true
    for (const [other, frame] of frames.current)
      if (other !== id) frame.contentWindow?.scrollTo(0, top)
    requestAnimationFrame(() => {
      syncing.current = false
    })
  }, [])
  const frameRefs = useMemo(
    () =>
      Object.fromEntries(
        LOOK_ORDER.map((id) => [
          id,
          (frame: HTMLIFrameElement | null) => {
            if (frame) frames.current.set(id, frame)
            else frames.current.delete(id)
          },
        ])
      ) as Record<LookVariantId, (frame: HTMLIFrameElement | null) => void>,
    []
  )

  // Focus starts on the look picked, and goes back where it was once the chooser closes.
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    root.current?.querySelector<HTMLElement>('[role=radio][aria-checked=true][data-look]')?.focus()
    return () => {
      if (before?.isConnected) before.focus()
    }
  }, [])
  // Focus follows the view: its own radios take over.
  const lastView = useRef(view)
  useEffect(() => {
    if (lastView.current === view) return
    lastView.current = view
    root.current
      ?.querySelector<HTMLElement>(`[data-look-view=${view}] [role=radio][aria-checked=true]`)
      ?.focus()
  }, [view])

  const showView = (next: LooksView) => {
    if (next === asked) return
    setAsked(next)
    kit.looksViewChanged(next)
  }
  const viewLarger = (id: LookVariantId) => {
    setPicked(id)
    showView('one')
  }

  const apply = () => {
    const variant = variants.find((each) => each.id === picked)
    if (!variant || picked === inUse) return
    if (
      kit.takeLook({
        variant,
        design,
        from,
        update,
        undoStep,
        ...(record && { record }),
      })
    )
      onClose()
  }

  const frameTheme = (each: LookVariant) =>
    each.design.mode === 'auto' ? theme : each.design.mode === 'dark' ? 'dark' : 'light'
  const { scale, height } = kit.lookFrameSize(box, width, view, zoom)
  const one = view === 'one'

  return (
    <section
      ref={root}
      aria-labelledby="looks-title"
      data-looks-chooser=""
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 px-6 pt-5 pb-4"
      onKeyDown={(event) => {
        // The builder's own keys, such as Delete for a picked block, do not reach past the chooser.
        event.stopPropagation()
        if (event.key !== 'Escape' || event.defaultPrevented) return
        if ((event.target as Element).closest('[role=dialog], [role=menu], [role=listbox]')) return
        event.preventDefault()
        onClose()
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id="looks-title" className="text-lg font-semibold">
            Pick a look
          </h2>
          <p className="text-ui text-muted-foreground">
            Same colours, fonts and words. Only the treatment changes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {viewport >= 960 && (
            <div
              role="radiogroup"
              aria-label="View"
              onKeyDown={onRadioKeys}
              className="flex rounded-lg bg-muted p-0.5"
            >
              {VIEWS.map(([value, name, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={view === value}
                  tabIndex={view === value ? 0 : -1}
                  onClick={() => showView(value)}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-ring',
                    view === value &&
                      'bg-background text-foreground shadow-sm forced-colors:outline forced-colors:outline-1'
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {name}
                </button>
              ))}
            </div>
          )}
          <DeviceToggle
            size={device}
            onSize={(next) => onDevice(next === 'phone' ? 'phone' : 'desktop')}
            devices={DEVICES}
            widths={LOOK_WIDTHS}
          />
          {one && <ZoomControl zoom={zoom} onZoom={setZoom} />}
        </div>
      </div>

      {one && (
        <div className="flex flex-wrap items-center gap-3" data-look-view="one">
          <div
            role="radiogroup"
            aria-label="Looks"
            onKeyDown={onRadioKeys}
            className="flex rounded-lg bg-muted p-0.5"
          >
            {LOOK_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                data-look={id}
                aria-checked={picked === id}
                tabIndex={picked === id ? 0 : -1}
                onClick={() => setPicked(id)}
                className={cn(
                  'h-8 rounded-md px-3.5 text-ui text-muted-foreground outline-none hover:text-foreground focus-ring',
                  picked === id &&
                    'bg-background font-semibold text-foreground shadow-sm forced-colors:outline forced-colors:outline-1'
                )}
              >
                {LOOK_NAMES[id]}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            ← → to switch. You stay on the same part of the page.
          </span>
        </div>
      )}

      <div
        role={one ? undefined : 'radiogroup'}
        aria-labelledby={one ? undefined : 'looks-title'}
        data-look-view={one ? undefined : 'side'}
        onKeyDown={one ? undefined : onRadioKeys}
        className={cn(
          'grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]',
          one ? 'grid-cols-1' : 'grid-cols-3'
        )}
        style={{ gap: GAP }}
      >
        {shown.map((each) => {
          const on = picked === each.id
          const hidden = one && !on
          return (
            <div
              key={each.id}
              data-look-card={each.id}
              className={cn(
                'flex min-h-0 min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-background p-2.5',
                one && '[grid-area:1/1]',
                !one && on && 'ring-2 ring-foreground',
                hidden && 'invisible'
              )}
              aria-hidden={hidden || undefined}
            >
              <div
                ref={boxRef(each.id)}
                className={cn(
                  'relative min-h-0 flex-1 rounded-md border border-border',
                  one && zoom !== 'fit' ? 'overflow-x-auto overflow-y-hidden' : 'overflow-hidden'
                )}
              >
                <div
                  className="relative mx-auto"
                  style={{ width: width * scale, height: height * scale }}
                >
                  <LookFrame
                    kit={kit}
                    name={LOOK_NAMES[each.id]}
                    design={each.design}
                    width={width}
                    scale={scale}
                    height={height}
                    theme={frameTheme(each)}
                    locale={locale}
                    onPick={() => setPicked(each.id)}
                    onEscape={onClose}
                    onScroll={(top) => scrolled(each.id, top)}
                    frameRef={frameRefs[each.id]}
                  />
                </div>
              </div>
              {/* Room for a two-line description in each, so the three pages stay one size. */}
              <div className={cn('flex min-h-13 items-start gap-2.5 px-1', one && 'hidden')}>
                <button
                  type="button"
                  role="radio"
                  data-look={each.id}
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => setPicked(each.id)}
                  className="flex min-h-6 min-w-0 flex-1 items-start gap-2.5 rounded-md text-start outline-none focus-ring"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border',
                      on ? 'border-foreground' : 'border-muted-foreground'
                    )}
                  >
                    {on && <span className="size-2 rounded-full bg-foreground" />}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className="text-ui font-semibold">{LOOK_NAMES[each.id]}</span>
                      {inUse === each.id && (
                        <span className="rounded-full bg-muted px-1.5 text-2xs text-muted-foreground">
                          In use
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">{LOOK_HINTS[each.id]}</span>
                  </span>
                </button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="ms-auto shrink-0"
                  onClick={() => viewLarger(each.id)}
                >
                  View larger<span className="sr-only">: {LOOK_NAMES[each.id]}</span>
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Change it any time in Theme › Look.</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Not now
          </Button>
          <Button type="button" disabled={picked === inUse} onClick={apply}>
            {picked === inUse ? 'In use' : `Use ${LOOK_NAMES[picked]}`}
          </Button>
        </div>
      </div>
    </section>
  )
}

const DEVICES = ['desktop', 'phone'] as const
