import { useRef, useSyncExternalStore, type ReactNode } from 'react'
import { motion, useReducedMotion, type Transition } from 'framer-motion'
import { SparklesIcon } from '@heroicons/react/24/outline'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AI_PANE,
  AI_RAIL_WIDTH,
  aiPaneFit,
  paneWidthAt,
  paneWidthOnKey,
} from '@/lib/shared/design/builder-chrome'
import { cn } from '@/lib/shared/utils'
import type { AiPane as AiPaneState } from './use-ai-pane'

/** The collapsed pane: a thin rail holding the way back in. */
export { AI_RAIL_WIDTH }

/** Below this many pixels the builder shows one column at a time (`--breakpoint-builder`). */
export const BUILDER_BREAKPOINT = 960

/**
 * How the pane's contents arrive: a short fade, at once while its edge is
 * dragged or for someone who asks for less motion. The width itself never
 * eases, so the canvas re-lays out once rather than on every frame.
 */
export function paneTransition(resizing: boolean, reduced = false): Transition {
  return resizing || reduced ? { duration: 0 } : { duration: 0.15, ease: [0.2, 0, 0, 1] }
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

/** The window's width, kept current; a wide window before the browser runs. */
export function useViewportWidth(): number {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth,
    () => 1440
  )
}

/**
 * Ask AI as a full-height pane on the left of the canvas: the conversation
 * over the request box, which the picked block rides along on. Its edge drags
 * (or takes the arrow keys) between 300 and 480 wide; collapsed, it is a thin
 * rail with Ask AI on it. Open, it never squeezes the canvas under its floor:
 * where it would, it lies over the canvas from the rail instead, and the rail's
 * button closes it again. In a one-column window it is one of the columns, and
 * always open there.
 */
export function AiPane({
  pane,
  hidden,
  viewport: given,
  children,
}: {
  pane: AiPaneState
  /** Out of view in a narrow window while another column shows. */
  hidden: boolean
  /** The window's width; the live one unless given. */
  viewport?: number
  children: ReactNode
}) {
  const live = useViewportWidth()
  const viewport = given ?? live
  const oneColumn = viewport < BUILDER_BREAKPOINT
  const collapsed = pane.collapsed && !oneColumn
  const width = pane.width
  const fit = aiPaneFit(width, viewport)
  const overlay = !collapsed && !oneColumn && fit.mode === 'overlay'
  // Docked, the pane gives way to the canvas's floor; lying over it, it is as wide as asked.
  const shown = fit.mode === 'docked' ? fit.width : width
  const drag = useRef<{ x: number; width: number } | null>(null)
  const reduced = useReducedMotion() ?? false
  const rail = (
    <div className="flex flex-col items-center py-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Ask AI"
            aria-expanded={!collapsed}
            aria-controls="designer-ai"
            onClick={collapsed ? pane.expand : pane.collapse}
            className={cn(
              'grid size-9 place-items-center rounded-lg text-chrome-active-icon outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-muted-foreground',
              !collapsed && 'bg-muted'
            )}
          >
            <SparklesIcon className="size-5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{collapsed ? 'Ask AI (/)' : 'Close Ask AI'}</TooltipContent>
      </Tooltip>
    </div>
  )
  const open = (
    <motion.div
      key="open"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={paneTransition(pane.resizing, reduced)}
      data-ai-pane-overlay={overlay ? '' : undefined}
      style={overlay ? { width: fit.width } : undefined}
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col',
        overlay &&
          'absolute inset-y-0 start-full z-sticky border-e border-border bg-background shadow-lg'
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Ask AI"
        aria-valuemin={AI_PANE.min}
        aria-valuemax={AI_PANE.max}
        aria-valuenow={shown}
        tabIndex={0}
        data-ai-pane-edge=""
        onKeyDown={(event) => {
          const next = paneWidthOnKey(event.key, shown)
          if (next === null) return
          event.preventDefault()
          pane.resize(next)
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { x: event.clientX, width: shown }
          pane.setResizing(true)
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          pane.resize(paneWidthAt(drag.current.width + event.clientX - drag.current.x), false)
        }}
        onPointerUp={(event) => {
          if (!drag.current) return
          pane.resize(paneWidthAt(drag.current.width + event.clientX - drag.current.x))
          drag.current = null
          pane.setResizing(false)
        }}
        onPointerCancel={() => {
          drag.current = null
          pane.setResizing(false)
        }}
        className="absolute inset-y-0 -end-1 z-raised w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:start-[3px] after:w-0.5 after:transition-colors hover:after:bg-border focus-visible:after:start-0.5 focus-visible:after:w-1 focus-visible:after:rounded-full focus-visible:after:bg-muted-foreground max-builder:hidden"
      />
    </motion.div>
  )
  return (
    <aside
      id="designer-ai-pane"
      aria-label="Ask AI"
      data-designer-region=""
      data-collapsed={collapsed ? '' : undefined}
      tabIndex={-1}
      style={{ width: collapsed || overlay ? AI_RAIL_WIDTH : shown }}
      className={cn(
        'relative flex shrink-0 border-e border-border bg-background outline-none',
        'max-builder:!w-full max-builder:border-e-0',
        hidden && 'max-builder:hidden'
      )}
    >
      {(collapsed || overlay) && rail}
      {!collapsed && open}
    </aside>
  )
}
