import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/shared/utils'

/**
 * The builder's icon-only button: a real tooltip naming what it does, on
 * hover and on focus. Disabled, it stays focusable and still says why, so it
 * is aria-disabled rather than disabled.
 */
export function IconButton({
  tip,
  label = tip,
  disabled = false,
  onClick,
  className,
  children,
}: {
  /** What it does, or why it cannot. */
  tip: string
  /** Its name, where it differs from the tip. */
  label?: string
  disabled?: boolean
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-disabled={disabled || undefined}
          className={cn(
            'aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent',
            className
          )}
          onClick={() => {
            if (!disabled) onClick()
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}
