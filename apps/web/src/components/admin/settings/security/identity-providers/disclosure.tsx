/**
 * A collapsed row that hides the settings most providers never need
 * (Connection options, Sign-in appearance, Account options). Callers open it
 * by default when something inside is off its default, so a non-standard
 * configuration never sits hidden behind a closed panel.
 */
import { useState } from 'react'
import { ChevronRightIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'

export function Disclosure({
  title,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  summary,
  children,
  className,
  testId,
}: {
  title: string
  defaultOpen?: boolean
  /** Controlled mode, for callers that need to react to opening. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Shown beside the title while closed, e.g. the one non-default value. */
  summary?: React.ReactNode
  children: React.ReactNode
  className?: string
  testId?: string
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = controlledOpen ?? uncontrolledOpen
  const toggle = () => {
    const next = !open
    setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  return (
    <div className={cn('rounded-md border border-border/50', className)} data-testid={testId}>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm font-medium"
        aria-expanded={open}
      >
        <ChevronRightIcon
          className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        <span className="flex-1">{title}</span>
        {!open && summary && (
          <span className="truncate text-sm font-normal text-muted-foreground">{summary}</span>
        )}
      </button>
      {open && <div className="space-y-5 border-t border-border/40 px-3 py-4">{children}</div>}
    </div>
  )
}
