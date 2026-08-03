'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useIntl } from 'react-intl'
import { BugAntIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'

interface BugTrackerHintCardProps {
  url: string
  show: boolean
  className?: string
}

function useContentHeight() {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setHeight(entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, height }
}

export function BugTrackerHintCard({
  url,
  show,
  className,
}: BugTrackerHintCardProps): React.ReactElement {
  const intl = useIntl()
  const showCard = show && !!url
  const { ref: contentRef, height: measuredHeight } = useContentHeight()

  return (
    <AnimatePresence>
      {showCard && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: measuredHeight || 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={cn('overflow-hidden', className)}
        >
          <div ref={contentRef}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 w-full rounded-lg hover:bg-muted/30 transition-colors px-2 py-1.5 cursor-pointer"
            >
              <BugAntIcon className="h-4 w-4 text-muted-foreground/60 shrink-0" />
              <span className="flex-1 min-w-0 text-sm text-foreground">
                {intl.formatMessage({
                  id: 'portal.feedback.bugTracker.heading',
                  defaultMessage: 'Reporting a bug? File it in our issue tracker instead',
                })}
              </span>
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
