import * as React from 'react'
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'

import { asChildRender, overlayTriggerProps } from '@/components/ui/as-child'
import { cn } from '@/lib/shared/utils'
import { buttonVariants } from '@/components/ui/button'

const AlertDialogActionsContext =
  React.createContext<React.RefObject<AlertDialogPrimitive.Root.Actions | null> | null>(null)

function AlertDialog({ actionsRef: actionsRefProp, ...props }: AlertDialogPrimitive.Root.Props) {
  const fallbackActionsRef = React.useRef<AlertDialogPrimitive.Root.Actions | null>(null)
  const actionsRef = actionsRefProp ?? fallbackActionsRef

  return (
    <AlertDialogActionsContext.Provider value={actionsRef}>
      <AlertDialogPrimitive.Root data-slot="alert-dialog" actionsRef={actionsRef} {...props} />
    </AlertDialogActionsContext.Provider>
  )
}

function AlertDialogTrigger({
  asChild,
  children,
  render,
  nativeButton,
  ...props
}: AlertDialogPrimitive.Trigger.Props & { asChild?: boolean }) {
  const composed = asChildRender(asChild, children, render)
  return (
    <AlertDialogPrimitive.Trigger
      data-slot="alert-dialog-trigger"
      {...props}
      nativeButton={composed.render ? composed.nativeButton : nativeButton}
      {...overlayTriggerProps(composed)}
    >
      {composed.children}
    </AlertDialogPrimitive.Trigger>
  )
}

function AlertDialogPortal(props: AlertDialogPrimitive.Portal.Props) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogOverlay({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 fixed inset-0 z-50 bg-black/50',
        className
      )}
      {...props}
    />
  )
}

function AlertDialogContent({ className, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        className={cn(
          'bg-background data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 [border-radius:var(--radius)] border p-6 shadow-lg duration-200 sm:max-w-lg',
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  )
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-lg font-semibold', className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  asChild,
  children,
  render,
  ...props
}: AlertDialogPrimitive.Description.Props & { asChild?: boolean }) {
  const composed = asChildRender(asChild, children, render)
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
      render={composed.render}
    >
      {composed.children}
    </AlertDialogPrimitive.Description>
  )
}

function AlertDialogAction({ className, onClick, ...props }: React.ComponentProps<'button'>) {
  const actionsRef = React.useContext(AlertDialogActionsContext)
  return (
    <button
      type="button"
      data-slot="alert-dialog-action"
      className={cn(buttonVariants(), className)}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) {
          actionsRef?.current?.close()
        }
      }}
      {...props}
    />
  )
}

function AlertDialogCancel({ className, ...props }: AlertDialogPrimitive.Close.Props) {
  return (
    <AlertDialogPrimitive.Close
      className={cn(buttonVariants({ variant: 'outline' }), className)}
      {...props}
    />
  )
}

AlertDialogTrigger.displayName = 'AlertDialogTrigger'

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
