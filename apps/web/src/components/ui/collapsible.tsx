import * as React from 'react'
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const Collapsible = CollapsiblePrimitive.Root

const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger

const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent

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
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex flex-1 items-center gap-2 hover:text-foreground/80 transition-colors"
          >
            <ChevronDown
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform duration-200',
                isOpen && 'rotate-180'
              )}
            />
            {icon}
            <div className="flex-1 text-left">
              <h3 className="font-medium text-sm">{title}</h3>
              {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
            </div>
          </button>
        </CollapsibleTrigger>
        {headerAction && <div onClick={(e) => e.stopPropagation()}>{headerAction}</div>}
      </div>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className={cn('px-4 pb-4 pt-2', contentClassName)}>{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent, CollapsibleSection }
