import { useRef, type ReactNode } from 'react'
import { motion, useReducedMotion, type Transition } from 'framer-motion'
import { SparklesIcon } from '@heroicons/react/24/outline'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AI_PANE, paneWidthAt, paneWidthOnKey } from '@/lib/shared/design/builder-chrome'
import { cn } from '@/lib/shared/utils'
import type { AiPane as AiPaneState } from './use-ai-pane'

/** The collapsed pane: a thin rail holding the way back in. */
export const AI_RAIL_WIDTH = 48

/**
 * How the pane opens and closes: briefly, and at once while its edge is
 * dragged or for someone who asks for less motion.
 */
export function paneTransition(resizing: boolean, reduced = false): Transition {
  return resizing || reduced ? { duration: 0 } : { duration: 0.18, ease: [0.2, 0, 0, 1] }
}

/**
 * Ask AI as a full-height pane on the left of the canvas: the conversation
 * over the request box, which the picked block rides along on. Its edge drags
 * (or takes the arrow keys) between 300 and 480 wide; collapsed, it is a thin
 * rail with Ask AI on it. In a narrow window it is one of the columns.
 */
export function AiPane({
  pane,
  hidden,
  children,
}: {
  pane: AiPaneState
  /** Out of view in a narrow window while another column shows. */
  hidden: boolean
  children: ReactNode
}) {
  const { collapsed, width } = pane
  const drag = useRef<{ x: number; width: number } | null>(null)
  const reduced = useReducedMotion() ?? false
  return (
    <motion.aside
      id="designer-ai-pane"
      aria-label="Ask AI"
      data-designer-region=""
      data-collapsed={collapsed ? '' : undefined}
      tabIndex={-1}
      initial={false}
      animate={{ width: collapsed ? AI_RAIL_WIDTH : width }}
      transition={paneTransition(pane.resizing, reduced)}
      className={cn(
        'relative flex shrink-0 flex-col border-e border-border bg-background outline-none',
        'max-[1100px]:!w-full max-[1100px]:border-e-0',
        hidden && 'max-[1100px]:hidden'
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center py-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Ask AI"
                aria-expanded={false}
                aria-controls="designer-ai"
                onClick={pane.expand}
                className="grid size-9 place-items-center rounded-lg text-amber-700 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-muted-foreground"
              >
                <SparklesIcon className="size-5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Ask AI (/)</TooltipContent>
          </Tooltip>
        </div>
      ) : (
        <>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Ask AI"
            aria-valuemin={AI_PANE.min}
            aria-valuemax={AI_PANE.max}
            aria-valuenow={width}
            tabIndex={0}
            data-ai-pane-edge=""
            onKeyDown={(event) => {
              const next = paneWidthOnKey(event.key, width)
              if (next === null) return
              event.preventDefault()
              pane.resize(next)
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.currentTarget.setPointerCapture(event.pointerId)
              drag.current = { x: event.clientX, width }
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
            className="absolute inset-y-0 -end-1 z-10 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:start-[3px] after:w-0.5 after:transition-colors hover:after:bg-border focus-visible:after:start-0.5 focus-visible:after:w-1 focus-visible:after:rounded-full focus-visible:after:bg-muted-foreground max-[1100px]:hidden"
          />
        </>
      )}
    </motion.aside>
  )
}
