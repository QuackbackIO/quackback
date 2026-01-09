import * as React from 'react'
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'
import { ChevronRightIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/utils'
import type { PostStatusEntity } from '@/lib/db-types'

interface StatusGroupProps {
  status: PostStatusEntity
  count: number
  isCollapsed: boolean
  onToggle: () => void
  children: React.ReactNode
}

export function StatusGroup({ status, count, isCollapsed, onToggle, children }: StatusGroupProps) {
  return (
    <CollapsiblePrimitive.Root open={!isCollapsed} onOpenChange={() => onToggle()}>
      <CollapsiblePrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            'group flex w-full items-center gap-2 px-3 py-2',
            'text-sm font-medium text-muted-foreground',
            'hover:bg-muted/30 transition-colors',
            'border-b border-border/30',
            'sticky top-[var(--header-height,113px)] z-[5] bg-card/95 backdrop-blur-sm'
          )}
        >
          <ChevronRightIcon
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground/70 transition-transform duration-200',
              !isCollapsed && 'rotate-90'
            )}
          />
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: status.color }}
          />
          <span className="text-foreground">{status.name}</span>
          <span
            className={cn(
              'ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-medium',
              'bg-muted/60 text-muted-foreground'
            )}
          >
            {count}
          </span>
        </button>
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="divide-y divide-border/30">{children}</div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  )
}
