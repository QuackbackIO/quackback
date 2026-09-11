import * as React from 'react'
import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'
import { ChevronDownIcon } from '@heroicons/react/24/solid'

import { asChildRender, overlayTriggerProps } from '@/components/ui/as-child'
import { cn } from '@/lib/shared/utils'

function Collapsible(props: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({
  asChild,
  children,
  render,
  nativeButton,
  ...props
}: CollapsiblePrimitive.Trigger.Props & { asChild?: boolean }) {
  const composed = asChildRender(asChild, children, render)
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      {...props}
      nativeButton={composed.render ? composed.nativeButton : nativeButton}
      {...overlayTriggerProps(composed)}
    >
      {composed.children}
    </CollapsiblePrimitive.Trigger>
  )
}

function CollapsibleContent({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={cn(
        'overflow-hidden data-closed:animate-collapsible-up data-open:animate-collapsible-down',
        className
      )}
      {...props}
    />
  )
}

interface CollapsibleSectionProps {
  title: string
  description?: string
  icon?: React.ReactNode
  headerAction?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  className?: string
  headerClassName?: string
  contentClassName?: string
}

function CollapsibleSection({
  title,
  description,
  icon,
  headerAction,
  children,
  defaultOpen = false,
  className,
  headerClassName,
  contentClassName,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <div
        className={cn(
          'flex w-full items-center justify-between rounded-lg px-4 py-3 text-left',
          headerClassName
        )}
      >
        <CollapsibleTrigger className="flex flex-1 items-center gap-2 hover:text-foreground/80 transition-colors">
          <ChevronDownIcon
            className={cn(
              'size-4 text-muted-foreground transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
          {icon}
          <div className="flex-1 text-left">
            <h3 className="font-medium text-sm">{title}</h3>
            {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          </div>
        </CollapsibleTrigger>
        {headerAction && <div onClick={(e) => e.stopPropagation()}>{headerAction}</div>}
      </div>
      <CollapsibleContent>
        <div className={cn('px-4 pb-4 pt-2', contentClassName)}>{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

CollapsibleTrigger.displayName = 'CollapsibleTrigger'

export { Collapsible, CollapsibleTrigger, CollapsibleContent, CollapsibleSection }
