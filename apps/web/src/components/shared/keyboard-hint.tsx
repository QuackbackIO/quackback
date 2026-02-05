import { Fragment } from 'react'
import { cn } from '@/lib/shared/utils'

interface KeyboardHintProps {
  keys: string[]
  action: string
  className?: string
}

export function KeyboardHint({ keys, action, className }: KeyboardHintProps) {
  return (
    <p className={cn('hidden sm:block text-xs text-muted-foreground', className)}>
      {keys.map((key, idx) => (
        <Fragment key={idx}>
          {idx > 0 && <span className="mx-1">+</span>}
          <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border">{key}</kbd>
        </Fragment>
      ))}
      <span className="ml-2">{action}</span>
    </p>
  )
}
