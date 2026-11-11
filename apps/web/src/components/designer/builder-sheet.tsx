import { useEffect, useRef, type ReactNode } from 'react'
import { motion, useIsPresent } from 'framer-motion'
import { ChevronRightIcon } from '@heroicons/react/16/solid'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * A sheet over the right panel, such as Theme or Add: headed by its name,
 * under a breadcrumb whose first crumb goes back to what the panel shows,
 * and a close. The panel underneath stays
 * as it was, so closing the sheet leaves everything where it was. Opening it
 * moves focus to its heading. It slides in over the panel and out again,
 * briefly; on its way out it takes no clicks.
 */
export function BuilderSheet({
  id,
  title,
  hint,
  back,
  onBack,
  onClose,
  footer,
  children,
}: {
  id: string
  title: string
  hint?: string
  /** What the panel under it shows, its first crumb, which goes back there. */
  back: string | null
  onBack: () => void
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [id])
  const present = useIsPresent()
  return (
    <motion.section
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      inert={!present}
      id={id}
      aria-labelledby={`${id}-title`}
      data-designer-sheet=""
      className="absolute inset-0 z-raised flex flex-col overflow-hidden bg-background"
    >
      <header className="space-y-1 border-b border-border px-4 pt-3 pb-3">
        <div className="flex items-center gap-2">
          {back ? (
            <nav aria-label="Where it is" className="text-xs text-muted-foreground">
              <ol className="flex items-center gap-1">
                <li>
                  <button
                    type="button"
                    onClick={onBack}
                    className="rounded hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
                  >
                    {back}
                  </button>
                </li>
                <li className="flex items-center gap-1">
                  <ChevronRightIcon className="size-3" aria-hidden="true" />
                  <span aria-current="location" className="text-foreground">
                    {title}
                  </span>
                </li>
              </ol>
            </nav>
          ) : (
            <span className="h-8" aria-hidden="true" />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ms-auto -me-1.5"
                aria-label={`Close ${title}`}
                onClick={onClose}
              >
                <XMarkIcon className="size-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close (Esc)</TooltipContent>
          </Tooltip>
        </div>
        <h2
          ref={heading}
          id={`${id}-title`}
          tabIndex={-1}
          className="text-sm font-semibold outline-none"
        >
          {title}
        </h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      {footer && (
        <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          {footer}
        </div>
      )}
    </motion.section>
  )
}
