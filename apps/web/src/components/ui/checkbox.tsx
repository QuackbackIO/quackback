import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { CheckIcon } from '@heroicons/react/24/solid'

import { cn } from '@/lib/shared/utils'

function Checkbox({
  className,
  checked,
  onClick,
  ...props
}: Omit<CheckboxPrimitive.Root.Props, 'checked'> & {
  checked?: boolean | 'indeterminate'
}) {
  const indeterminate = checked === 'indeterminate'
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      nativeButton
      render={<button type="button" />}
      checked={indeterminate ? false : checked}
      indeterminate={indeterminate}
      className={cn(
        'peer border-input dark:bg-input/30 data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary data-checked:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
      onClick={(event) => {
        // A <button> checkbox nested in a <label> re-dispatches the click onto
        // the control. Happy-dom (and some label implementations) then bubble
        // that click back to the label and loop until the stack overflows.
        event.stopPropagation()
        onClick?.(event)
      }}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
