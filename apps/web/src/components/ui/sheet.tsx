import * as React from 'react'
import { Dialog as SheetPrimitive } from '@base-ui/react/dialog'
import { XMarkIcon } from '@heroicons/react/24/solid'

import { asChildRender, overlayTriggerProps } from '@/components/ui/as-child'
import { cn } from '@/lib/shared/utils'

function Sheet(props: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  asChild,
  children,
  render,
  nativeButton,
  ...props
}: SheetPrimitive.Trigger.Props & { asChild?: boolean }) {
  const composed = asChildRender(asChild, children, render)
  return (
    <SheetPrimitive.Trigger
      data-slot="sheet-trigger"
      {...props}
      nativeButton={composed.render ? composed.nativeButton : nativeButton}
      {...overlayTriggerProps(composed)}
    >
      {composed.children}
    </SheetPrimitive.Trigger>
  )
}

function SheetPortal(props: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/50',
        'data-open:animate-in data-closed:animate-out',
        'data-closed:fade-out-0 data-open:fade-in-0',
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = 'right',
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          'fixed z-50 flex flex-col gap-4 bg-background shadow-lg',
          'transition-transform ease-out data-closed:duration-200 data-open:duration-300',
          'data-open:animate-in data-closed:animate-out',
          side === 'right' &&
            'inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm data-closed:slide-out-to-right data-open:slide-in-from-right',
          side === 'left' &&
            'inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm data-closed:slide-out-to-left data-open:slide-in-from-left',
          side === 'top' &&
            'inset-x-0 top-0 h-auto border-b data-closed:slide-out-to-top data-open:slide-in-from-top',
          side === 'bottom' &&
            'inset-x-0 bottom-0 h-auto border-t data-closed:slide-out-to-bottom data-open:slide-in-from-bottom',
          className
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          className={cn(
            'absolute top-4 right-4 rounded-xs',
            'opacity-70 transition-opacity hover:opacity-100',
            'ring-offset-background focus:ring-ring focus:ring-2 focus:ring-offset-2 focus:outline-hidden',
            'data-open:bg-secondary disabled:pointer-events-none'
          )}
        >
          <XMarkIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 p-4', className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-foreground font-semibold', className)}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  )
}

SheetTrigger.displayName = 'SheetTrigger'

export { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription }
