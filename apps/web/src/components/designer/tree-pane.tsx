import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ChevronRightIcon } from '@heroicons/react/16/solid'
import { useSessionContext } from '@/lib/client/hooks/use-root-context'
import type { useDesignDraft } from '@/components/admin/settings/appearance/use-design-draft'
import type { MenuPartId } from '@/lib/shared/design/menu'
import type { DesignerPage, OutlineNode, Selection } from '@/lib/shared/design/outline'
import { pageTree, treeRows, type TreeRow } from '@/lib/shared/design/page-tree'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { cn } from '@/lib/shared/utils'
import { dispatcher } from './dispatcher'
import { PageTree } from './page-tree'
import { WORDS } from './properties/words'
import { useBlockActions } from './use-block-actions'

/** Changes the draft under a name, so undo says what it takes back. */
type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

/** Where the builder remembers "On this page", folded or not and how tall, per person. */
export const treePaneKey = (userId: string) => `quackback:designer-tree-pane:${userId}`

/**
 * The tree's shortest and tallest heights, in pixels. Until its divider is
 * moved it fits its rows, up to `fit` (or 40% of the window, if less).
 */
export const TREE_PANE = { min: 72, max: 560, fit: 360 } as const
/** How far one arrow key moves the divider. */
const STEP = 16

export interface TreePaneState {
  collapsed: boolean
  /** The height its divider was moved to; null fits the rows. */
  height: number | null
}

const clamp = (height: number) =>
  Math.round(Math.min(TREE_PANE.max, Math.max(TREE_PANE.min, height)))

/** What was remembered, or the usual pane for anything unreadable. */
export function readTreePane(raw: string | null): TreePaneState {
  const usual = { collapsed: false, height: null }
  if (!raw) return usual
  try {
    const parsed = JSON.parse(raw) as Partial<TreePaneState>
    return {
      collapsed: parsed.collapsed === true,
      height: typeof parsed.height === 'number' ? clamp(parsed.height) : usual.height,
    }
  } catch {
    return usual
  }
}

/**
 * Whether a scroll area has more above or below what shows, kept current as it
 * scrolls, resizes or its rows change: the cue that there is more to see.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [edges, setEdges] = useState({ above: false, below: false })
  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const above = el.scrollTop > 0
    const below = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setEdges((was) => (was.above === above && was.below === below ? was : { above, below }))
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    if (el.firstElementChild) watch.observe(el.firstElementChild)
    return () => watch.disconnect()
  })
  return { ref, edges, measure }
}

/** The tree pane's state, remembered on this device for the person signed in. */
function useTreePane() {
  const session = useSessionContext()
  const userId = session?.user?.id ?? null
  const [state, setState] = useState<TreePaneState>(() => readTreePane(null))
  useEffect(() => {
    if (!userId) return
    try {
      setState(readTreePane(localStorage.getItem(treePaneKey(userId))))
    } catch {
      // Storage closed: the pane opens as usual.
    }
  }, [userId])
  const remember = useCallback(
    (next: TreePaneState) => {
      setState(next)
      if (!userId) return
      try {
        localStorage.setItem(treePaneKey(userId), JSON.stringify(next))
      } catch {
        // Storage closed: forgotten next time.
      }
    },
    [userId]
  )
  return { state, setState, remember }
}

/**
 * "On this page", pinned above the picked part's settings so the page's
 * structure stays in view whatever is picked: the current pick highlighted,
 * folded from its heading. It fits its rows up to a cap, with a shadow at
 * an edge that has more past it, until its divider is dragged.
 */
export function TreePane({
  page,
  design,
  update,
  nodes,
  gates,
  picked,
  onPick,
  act,
  say,
}: {
  page: DesignerPage
  design: PortalDesign
  update: NamedUpdate
  nodes: readonly OutlineNode[]
  gates: PortalPageGates
  /** What is picked now, highlighted in the tree. */
  picked: Selection | null
  /** A row picked, as a click on the canvas picks it. */
  onPick: (row: TreeRow) => void
  /** A menu item's actions, as the header's panel takes them. */
  act?: (target: MenuPartId, action: 'show' | 'hide' | 'up' | 'down', from: 'panel') => void
  say?: (words: string) => void
}) {
  const tree = useMemo(() => pageTree(design, gates, page, nodes), [design, gates, page, nodes])
  const dispatch = dispatcher(design, update)
  const blocks = useBlockActions({
    draft: { design, update } as unknown as Pick<
      ReturnType<typeof useDesignDraft>,
      'design' | 'update'
    >,
    selection: null,
    setSelection: () => {},
    nameOf: (key) => treeRows(tree).find((row) => row.key === key)?.label,
    say: (words) => say?.(words),
    gates,
  })
  const { state, setState, remember } = useTreePane()
  const drag = useRef<{ y: number; height: number } | null>(null)
  const scroll = useScrollEdges<HTMLDivElement>()
  const bodyId = 'designer-tree-pane'
  if (!tree.length) return null
  // Fitting its rows, the divider starts from the height it shows.
  const height = state.height ?? clamp(scroll.ref.current?.clientHeight ?? TREE_PANE.min)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { y: event.clientY, height }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    setState({ ...state, height: clamp(drag.current.height + event.clientY - drag.current.y) })
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const height = clamp(drag.current.height + event.clientY - drag.current.y)
    drag.current = null
    remember({ ...state, height })
  }

  return (
    <section
      data-tree-pane=""
      aria-labelledby={`${bodyId}-heading`}
      className="flex shrink-0 flex-col"
    >
      <h2 id={`${bodyId}-heading`} className="px-3 pt-2">
        <button
          type="button"
          aria-expanded={!state.collapsed}
          aria-controls={bodyId}
          onClick={() => remember({ ...state, collapsed: !state.collapsed })}
          className="flex min-h-7 w-full items-center gap-1 rounded-md px-1 text-start text-xs font-medium hover:bg-muted focus-ring"
        >
          <ChevronRightIcon
            className={cn('size-3.5 transition-transform', !state.collapsed && 'rotate-90')}
            aria-hidden="true"
          />
          {WORDS.onThisPage}
        </button>
      </h2>
      <div hidden={state.collapsed} className="relative min-h-0">
        <div
          id={bodyId}
          ref={scroll.ref}
          onScroll={scroll.measure}
          data-more-above={scroll.edges.above ? '' : undefined}
          data-more-below={scroll.edges.below ? '' : undefined}
          style={
            state.height === null
              ? { maxHeight: `min(40vh, ${TREE_PANE.fit}px)` }
              : { height: state.height }
          }
          className="max-h-[60vh] overflow-y-auto px-3 pb-2"
        >
          <PageTree
            label={WORDS.onThisPage}
            rows={tree}
            picked={picked}
            onPick={onPick}
            onShown={(row, shown) => {
              if (row.menu) return act?.(row.menu, shown ? 'show' : 'hide', 'panel')
              const name = `${shown ? WORDS.show : WORDS.hide} ${row.label}`
              dispatch({ op: 'part.shown', key: row.key, shown }, name)
              say?.(`${name}. Undo takes it back.`)
            }}
            onMove={(row, by) => {
              if (row.menu) return act?.(row.menu, by < 0 ? 'up' : 'down', 'panel')
              if (row.key.startsWith('block-')) blocks.moveBlock(row.key, by)
            }}
          />
        </div>
        {/* Shadows at an edge with more rows past it. */}
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 h-3 bg-gradient-to-b from-foreground/10 to-transparent transition-opacity motion-reduce:transition-none',
            scroll.edges.above ? 'opacity-100' : 'opacity-0'
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-foreground/10 to-transparent transition-opacity motion-reduce:transition-none',
            scroll.edges.below ? 'opacity-100' : 'opacity-0'
          )}
        />
      </div>
      {state.collapsed ? (
        <div className="border-b border-border" />
      ) : (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize ${WORDS.onThisPage}`}
          aria-controls={bodyId}
          aria-valuemin={TREE_PANE.min}
          aria-valuemax={TREE_PANE.max}
          aria-valuenow={height}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={(event) => {
            const to =
              event.key === 'ArrowUp'
                ? height - STEP
                : event.key === 'ArrowDown'
                  ? height + STEP
                  : event.key === 'Home'
                    ? TREE_PANE.min
                    : event.key === 'End'
                      ? TREE_PANE.max
                      : null
            if (to === null) return
            event.preventDefault()
            remember({ ...state, height: clamp(to) })
          }}
          className="group relative h-2 shrink-0 cursor-row-resize touch-none border-b border-border outline-none focus-visible:bg-muted"
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-0.5 group-hover:bg-muted-foreground/40"
          />
        </div>
      )}
    </section>
  )
}
