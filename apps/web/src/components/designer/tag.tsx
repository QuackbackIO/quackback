import type { ReactNode } from 'react'
import { cn } from '@/lib/shared/utils'

/** A quiet tag after a row's name. */
export function Tag({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'new' }) {
  return (
    <span
      className={cn(
        'ms-1.5 shrink-0 rounded-full px-1.5 text-[11px] leading-5',
        tone === 'new'
          ? 'bg-primary/15 font-medium text-foreground'
          : 'bg-muted text-muted-foreground'
      )}
    >
      {children}
    </span>
  )
}
