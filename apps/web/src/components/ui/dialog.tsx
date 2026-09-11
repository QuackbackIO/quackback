import * as React from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { XMarkIcon } from '@heroicons/react/24/solid'

import { asChildRender, overlayTriggerProps } from '@/components/ui/as-child'
import { cn } from '@/lib/shared/utils'

function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  asChild,
  children,
  render,
  nativeButton,
  ...props
}: DialogPrimitive.Trigger.Props & { asChild?: boolean }) {
  const composed = asChildRender(asChild, children, render)
  return (
    <DialogPrimitive.Trigger
      data-slot="dialog-trigger"
      {...props}
      nativeButton={composed.render ? composed.nativeButton : nativeButton}
      {...overlayTriggerProps(composed)}
    >
      {composed.children}
    </DialogPrimitive.Trigger>
  )
}

function DialogPortal(props: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  asChild,
  children,
  render,
  nativeButton,
  ...props
}: DialogPrimitive.Close.Props & { asChild?: boolean }) {
  const composed = asChildRender(asChild, children, render)
  return (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      {...props}
      nativeButton={composed.render ? composed.nativeButton : nativeButton}
      {...overlayTriggerProps(composed)}
    >
      {composed.children}
    </DialogPrimitive.Close>
  )
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 fixed inset-0 z-50 bg-black/50',
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  instant = false,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  instant?: boolean
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay className={instant ? '!animate-none !duration-0' : undefined} />
      <DialogPrimitive.Popup
        aria-describedby={undefined}
        data-slot="dialog-content"
        className={cn(
          'bg-background fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 [border-radius:var(--radius)] border p-6 shadow-lg outline-none',
          !instant &&
            'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 duration-200',
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-open:bg-accent data-open:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XMarkIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  asChild,
  children,
  render,
  ...props
}: DialogPrimitive.Description.Props & { asChild?: boolean }) {
  const composed = asChildRender(asChild, children, render)
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
      render={composed.render}
    >
      {composed.children}
    </DialogPrimitive.Description>
  )
}

DialogTrigger.displayName = 'DialogTrigger'

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
