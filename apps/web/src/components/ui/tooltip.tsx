import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'

import { asChildRender, overlayTriggerProps } from '@/components/ui/as-child'
import {
  OverlayOpenedContext,
  useOverlayOpened,
  useOverlayOpenedRoot,
} from '@/components/ui/overlay-opened'
import { cn } from '@/lib/shared/utils'

function TooltipProvider({ delay = 0, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />
}

function Tooltip({ open, defaultOpen, onOpenChange, ...props }: TooltipPrimitive.Root.Props) {
  const opened = useOverlayOpenedRoot(open, defaultOpen, onOpenChange)
  // Its own provider (as TooltipProvider sets it up), without the extra layer.
  return (
    <TooltipPrimitive.Provider delay={0}>
      <OverlayOpenedContext.Provider value={opened.value}>
        <TooltipPrimitive.Root
          data-slot="tooltip"
          open={open}
          defaultOpen={defaultOpen}
          onOpenChange={opened.onOpenChange}
          {...props}
        />
      </OverlayOpenedContext.Provider>
    </TooltipPrimitive.Provider>
  )
}

function TooltipTrigger({
  asChild,
  children,
  render,
  nativeButton: _nativeButton,
  ...props
}: TooltipPrimitive.Trigger.Props & { asChild?: boolean; nativeButton?: boolean }) {
  const composed = asChildRender(asChild, children, render)
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      {...props}
      {...overlayTriggerProps(composed, { nativeButton: false })}
    >
      {composed.children}
    </TooltipPrimitive.Trigger>
  )
}

/**
 * `anchor` positions the popup against an element other than a trigger: one
 * controlled tooltip can then serve many plain elements (e.g. the 90 days of
 * a status uptime bar) instead of each carrying its own trigger.
 */
function TooltipContent({
  className,
  sideOffset = 6,
  side = 'top',
  align = 'center',
  alignOffset = 0,
  anchor,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'anchor' | 'side' | 'sideOffset'
  >) {
  // Nothing to portal until the tooltip first opens.
  const opened = useOverlayOpened()
  if (!opened) return null
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            'z-50 px-2.5 py-1.5 text-xs font-medium',
            'bg-popover text-popover-foreground',
            'rounded-[0.375rem] border border-border shadow-md',
            'origin-(--transform-origin)',
            'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95',
            'data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            'data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1',
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

TooltipTrigger.displayName = 'TooltipTrigger'

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
