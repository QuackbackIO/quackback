/**
 * Radix Select relies on pointer-capture and layout APIs jsdom/happy-dom
 * don't implement. This test double flattens the compound `Select` API onto
 * one native `<select>` — the `id`/`aria-label` on `SelectTrigger` and the
 * `<option>`s from `SelectContent`'s `SelectItem`s are lifted onto it — so a
 * test can drive and assert selection with an ordinary change event and
 * `toHaveValue`, rather than simulating Radix's pointer-driven popover.
 *
 * Usage: `vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))`
 */
import { Children, isValidElement, type ReactNode } from 'react'

interface SelectProps {
  value?: string
  onValueChange: (value: string) => void
  disabled?: boolean
  children?: ReactNode
}

interface TriggerProps {
  id?: string
  'aria-label'?: string
  className?: string
}

export function Select({ value, onValueChange, disabled, children }: SelectProps) {
  let triggerProps: TriggerProps = {}
  let options: ReactNode = null

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    if (child.type === SelectTrigger) triggerProps = child.props as TriggerProps
    if (child.type === SelectContent) options = (child.props as { children?: ReactNode }).children
  })

  return (
    <select
      id={triggerProps.id}
      aria-label={triggerProps['aria-label']}
      className={triggerProps.className}
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {options}
    </select>
  )
}

/** Props are lifted onto the native select by `Select` above; renders nothing itself. */
export function SelectTrigger(_props: TriggerProps & { children?: ReactNode }) {
  return null
}

export function SelectValue() {
  return null
}

/** Its children (the `SelectItem`s) are lifted onto the native select by `Select` above. */
export function SelectContent({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

export function SelectItem({ value, children }: { value: string; children: ReactNode }) {
  return <option value={value}>{children}</option>
}
