import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { SETTINGS_WIDTH } from '@/lib/shared/design/builder-chrome'
import { cn } from '@/lib/shared/utils'
import { WORDS } from './properties/words'

/** The panel's width. */
export const RIGHT_PANEL_WIDTH = SETTINGS_WIDTH

/** How the panel's contents change: a quick cross-fade that never holds up a click. */
const FADE = { duration: 0.15, ease: 'easeOut' } as const

/**
 * The right panel, the properties, always open at one width so the canvas
 * never re-lays out for it. It holds the page's own panel with nothing picked,
 * the picked part's otherwise. A sheet such as Theme or Add lies over it edge
 * to edge; underneath stays mounted and out of reach until the sheet closes.
 * What the panel holds fades in when it changes. In a one-column window it
 * keeps its width, centred, rather than stretching every control.
 */
export function RightPanel({
  hidden,
  sheet,
  showing,
  pinned,
  children,
}: {
  /** Kept above what the panel holds whatever is picked: the page's tree. */
  pinned?: ReactNode
  /** Out of view in a narrow window while another column shows. */
  hidden: boolean
  /** The sheet over the panel, if one is open. */
  sheet: ReactNode
  /** What the panel holds, such as a pick, which fades in when it changes. */
  showing: string
  children: ReactNode
}) {
  const still = useReducedMotion() ? { duration: 0 } : null
  return (
    <aside
      id="designer-settings"
      data-designer-region=""
      tabIndex={-1}
      aria-label={WORDS.properties}
      style={{ width: RIGHT_PANEL_WIDTH }}
      className={cn(
        // Clipped, never scrolled: only the panel's own scroll area moves when a field takes focus.
        'relative flex shrink-0 flex-col overflow-clip border-s border-border bg-background outline-none',
        'max-builder:!w-full max-builder:border-s-0',
        hidden && 'max-builder:hidden'
      )}
    >
      {/* Capped, so a one-column window never stretches the controls. */}
      <div className="relative mx-auto flex min-h-0 w-full max-w-[420px] flex-1 flex-col max-builder:border-x max-builder:border-border">
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
    </aside>
  )
}
