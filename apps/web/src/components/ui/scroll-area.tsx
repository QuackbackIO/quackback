import type { Ref } from 'react'
import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area'

import { cn } from '@/lib/shared/utils'

/**
 * Base UI follows the pointer into and out of a scroll area to set a
 * `data-hovering` attribute on its scrollbar. Nothing here styles that, and
 * each crossing rendered the area's root and every part of it again (the
 * admin rail on the way to each conversation or post it opens), so the area
 * leaves the pointer alone. A caller that passes its own handler still gets
 * the events.
 */
const ignorePointer = (event: { preventBaseUIHandler: () => void }) => event.preventBaseUIHandler()

function ScrollArea({
  className,
  children,
  scrollBarClassName,
  viewportRef,
  type: _type,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  scrollBarClassName?: string
  /** Ref to the scrolling viewport — e.g. for a virtualizer's getScrollElement. */
  viewportRef?: Ref<HTMLDivElement>
  /** Radix scrollbar visibility — ignored; native/Base UI scrollbars always show when needed. */
  type?: 'auto' | 'always' | 'scroll' | 'hover'
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative', className)}
      onPointerEnter={ignorePointer}
      onPointerMove={ignorePointer}
      onPointerLeave={ignorePointer}
      {...props}
    >
      {/*
        `max-h-[inherit]` picks up a `max-h-*` set on the root. Without it the
        viewport's `size-full` resolves to `auto` next to a root whose height is
        only bounded by `max-height`, so it grows to its content and never
        scrolls — the content spills out of the root instead.
      */}
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className="focus-visible:ring-ring/50 size-full max-h-[inherit] rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar className={scrollBarClassName} />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors select-none',
        orientation === 'vertical' && 'h-full w-2.5',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent',
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar }
