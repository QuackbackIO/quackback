import * as React from 'react'
import { Switch as SwitchPrimitive } from '@base-ui/react/switch'

import { cn } from '@/lib/shared/utils'

const Switch = React.forwardRef<HTMLButtonElement, SwitchPrimitive.Root.Props>(
  ({ className, onClick, ...props }, ref) => (
    <SwitchPrimitive.Root
      data-slot="switch"
      nativeButton
      render={<button type="button" />}
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-primary data-unchecked:bg-input',
        className
      )}
      {...props}
      onClick={(event) => {
        // Same label-loop guard as Checkbox: a button control nested in a
        // <label> re-dispatches the click onto itself and loops.
        event.stopPropagation()
        onClick?.(event)
      }}
      ref={ref}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-checked:translate-x-4 data-unchecked:translate-x-0'
        )}
      />
    </SwitchPrimitive.Root>
  )
)
Switch.displayName = 'Switch'

export { Switch }
