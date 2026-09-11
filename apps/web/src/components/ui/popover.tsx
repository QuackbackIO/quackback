import * as React from 'react'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'

import { asChildRender, overlayTriggerProps } from '@/components/ui/as-child'
import { cn } from '@/lib/shared/utils'

/**
 * When a Popover is inside a Dialog, we portal to the dialog content element
 * instead of document.body. This keeps the popover inside react-remove-scroll's
 * boundary so wheel events work on scrollable content inside the popover.
 */
const PortalContainerContext = React.createContext<{
  container: HTMLElement | null
  setTriggerEl: (el: HTMLElement | null) => void
  anchor: HTMLElement | null
  setAnchor: (el: HTMLElement | null) => void
}>({ container: null, setTriggerEl: () => {}, anchor: null, setAnchor: () => {} })

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  const [container, setContainer] = React.useState<HTMLElement | null>(null)
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null)

  const setTriggerEl = React.useCallback((el: HTMLElement | null) => {
    if (!el) return
    const dialog = el.closest<HTMLElement>('[data-slot="dialog-content"]')
    setContainer(dialog)
  }, [])

  const ctx = React.useMemo(
    () => ({ container, setTriggerEl, anchor, setAnchor }),
    [container, setTriggerEl, anchor]
  )

  return (
    <PortalContainerContext.Provider value={ctx}>
      <PopoverPrimitive.Root data-slot="popover" {...props} />
    </PortalContainerContext.Provider>
  )
}

function PopoverTrigger({
  asChild,
  children,
  render,
  nativeButton,
  ref: externalRef,
  ...props
}: PopoverPrimitive.Trigger.Props & { asChild?: boolean }) {
  const { setTriggerEl } = React.useContext(PortalContainerContext)
  const composed = asChildRender(asChild, children, render)

  return (
    <PopoverPrimitive.Trigger
      data-slot="popover-trigger"
      ref={(node: HTMLButtonElement | null) => {
        setTriggerEl(node)
        if (typeof externalRef === 'function') {
          ;(externalRef as (el: HTMLElement | null) => void)(node)
        } else if (externalRef) {
          ;(externalRef as React.MutableRefObject<HTMLElement | null>).current = node
        }
      }}
      {...props}
      nativeButton={composed.render ? composed.nativeButton : nativeButton}
      {...overlayTriggerProps(composed)}
    >
      {composed.children}
    </PopoverPrimitive.Trigger>
  )
}

function PopoverAnchor({
  asChild,
  children,
  className,
  ...props
}: React.ComponentProps<'div'> & { asChild?: boolean }) {
  const { setAnchor, setTriggerEl } = React.useContext(PortalContainerContext)
  const composed = asChildRender(asChild, children)

  const setRefs = (node: HTMLElement | null) => {
    setAnchor(node)
    setTriggerEl(node)
  }

  if (composed.render && React.isValidElement(composed.render)) {
    const existingRef = (composed.render.props as { ref?: React.Ref<HTMLElement> }).ref
    return React.cloneElement(
      composed.render as React.ReactElement<{ ref?: React.Ref<HTMLElement> }>,
      {
        ref: (node: HTMLElement | null) => {
          setRefs(node)
          if (typeof existingRef === 'function') existingRef(node)
          else if (existingRef)
            (existingRef as React.MutableRefObject<HTMLElement | null>).current = node
        },
      }
    )
  }

  return (
    <div ref={setRefs} data-slot="popover-anchor" className={className} {...props}>
      {children}
    </div>
  )
}

function PopoverContent({
  className,
  align = 'center',
  side = 'bottom',
  sideOffset = 4,
  alignOffset = 0,
  container: containerProp,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'> & {
    container?: HTMLElement | null
  }) {
  const { container: dialogContainer, anchor } = React.useContext(PortalContainerContext)
  const portalContainer = containerProp ?? dialogContainer ?? undefined

  return (
    <PopoverPrimitive.Portal container={portalContainer}>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor ?? undefined}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--transform-origin) [border-radius:calc(var(--radius)*0.8)] border p-4 shadow-md outline-hidden',
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

PopoverTrigger.displayName = 'PopoverTrigger'

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
