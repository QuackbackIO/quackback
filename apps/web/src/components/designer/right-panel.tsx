import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/shared/utils'
import { WORDS } from './properties/words'

/** The panel's width when open. */
export const RIGHT_PANEL_WIDTH = 340

/** How the panel's contents change: a quick cross-fade that never holds up a click. */
const FADE = { duration: 0.15, ease: 'easeOut' } as const
/** How the panel opens and closes, the canvas easing into the room it leaves. */
const SLIDE = { duration: 0.2, ease: [0.2, 0, 0, 1] } as const

/**
 * The right panel, the properties. It holds the page's own panel with
 * nothing picked, the picked part's otherwise; closed only once Escape has
 * closed the page's panel, it slides open again for a pick or a sheet, the
 * canvas easing narrower rather than jumping. A sheet such as Theme or Add lies over it; underneath stays
 * mounted, dimmed and out of reach until the sheet closes. What the panel
 * holds fades in when it changes; the sheet slides over it (see BuilderSheet).
 */
export function RightPanel({
  open,
  hidden,
  sheet,
  showing,
  pinned,
  children,
}: {
  /** Kept above what the panel holds whatever is picked: the page's tree. */
  pinned?: ReactNode
  /** Whether the panel is open: it is, unless Escape closed the page's panel. */
  open: boolean
  /** Out of view in a narrow window while another column shows. */
  hidden: boolean
  /** The sheet over the panel, if one is open. */
  sheet: ReactNode
  /** What the panel holds, such as a pick, which fades in when it changes. */
  showing: string
  children: ReactNode
}) {
  // Width is not a transform, so less motion is asked for here as well as by MotionConfig.
  const still = useReducedMotion() ? { duration: 0 } : null
  return (
    <motion.aside
      id="designer-settings"
      data-designer-region=""
      data-open={open ? '' : undefined}
      tabIndex={-1}
      aria-label={WORDS.properties}
      inert={!open}
      initial={false}
      animate={{ width: open ? RIGHT_PANEL_WIDTH : 0 }}
      transition={still ?? SLIDE}
      className={cn(
        // Clipped, never scrolled: only the panel's own scroll area moves when a field takes focus.
        'relative flex shrink-0 flex-col overflow-clip bg-background outline-none',
        open && 'border-s border-border',
        'max-[1100px]:!w-full max-[1100px]:border-s-0',
        hidden && 'max-[1100px]:hidden'
      )}
    >
      {/* A fixed width inside, so the contents never reflow as the panel slides. */}
      <div className="relative flex min-h-0 w-[340px] flex-1 flex-col max-[1100px]:w-full">
        {pinned && (
          <div
            data-panel-pinned=""
            inert={!!sheet}
            className={cn(
              'transition-opacity motion-reduce:transition-none',
              sheet && 'opacity-40'
            )}
          >
            {pinned}
          </div>
        )}
        <div
          data-panel-under=""
          inert={!!sheet}
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-y-auto transition-opacity motion-reduce:transition-none',
            sheet && 'opacity-40'
          )}
        >
          <motion.div
            key={showing}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={still ?? FADE}
            className="flex min-h-0 flex-1 flex-col"
          >
            {children}
          </motion.div>
        </div>
        <AnimatePresence initial={false}>{sheet}</AnimatePresence>
      </div>
    </motion.aside>
  )
}
