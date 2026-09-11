import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { CheckIcon } from '@heroicons/react/24/solid'

import { cn } from '@/lib/shared/utils'

function Checkbox({
  className,
  checked,
  onClick,
  onCheckedChange,
  ...props
}: Omit<CheckboxPrimitive.Root.Props, 'checked'> & {
  checked?: boolean | 'indeterminate'
}) {
  const indeterminate = checked === 'indeterminate'
  // When embedded as a pure visual in a clickable row (no onCheckedChange of
  // its own — the row's onClick owns the toggle), don't intercept the click:
  // stopping propagation there would swallow the row's handler and the box
  // would look dead. A checkbox with its own onCheckedChange inside a <label>
  // is intentionally left alone: the label re-dispatch drives the toggle, and
  // stopping that propagation breaks the label activation (checkout-builder).
  // The label-loop guard below therefore only applies when the box is neither
  // decorative nor label-driven.
  const inLabel = (props as { ['data-in-label']?: boolean })['data-in-label'] === true
  const decorative = onCheckedChange === undefined
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
      onCheckedChange={onCheckedChange}
      onClick={(event) => {
        if (!decorative && !inLabel) {
          // A <button> checkbox nested in a <label> re-dispatches the click onto
          // the control. Happy-dom (and some label implementations) then bubble
          // that click back to the label and loop until the stack overflows.
          // Inside a real <label> (data-in-label) the label's own activation
          // drives the toggle, so leave that path alone (checkout-builder).
          event.stopPropagation()
        }
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
