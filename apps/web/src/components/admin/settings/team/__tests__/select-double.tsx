/**
 * Test double for the Base UI select, which needs layout APIs happy-dom
 * lacks: flattens it onto a native select that keeps groups (as optgroups
 * labelled by their SelectLabel) and disabled items, so a test drives it
 * with a change event and reads groups and options by role.
 *
 * Usage: `vi.mock('@/components/ui/select', () => import('./select-double'))`
 */
import { Children, isValidElement, type ReactNode } from 'react'

function collect(node: ReactNode): ReactNode {
  return Children.map(node, (child) => {
    if (!isValidElement(child)) return null
    const props = child.props as { value?: string; disabled?: boolean; children?: ReactNode }
    if (child.type === SelectItem) {
      return (
        <option value={props.value} disabled={props.disabled}>
          {props.children}
        </option>
      )
    }
    if (child.type === SelectLabel) return null
    if (child.type === SelectGroup) {
      const label = Children.toArray(props.children).find(
        (c) => isValidElement(c) && c.type === SelectLabel
      ) as { props: { children: string } } | undefined
      return <optgroup label={label?.props.children}>{collect(props.children)}</optgroup>
    }
    return collect(props.children)
  })
}

export function Select({
  value,
  onValueChange,
  children,
}: {
  value: string
  onValueChange: (v: string) => void
  children: ReactNode
}) {
  let id: string | undefined
  let content: ReactNode = null
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    if (child.type === SelectTrigger) id = (child.props as { id?: string }).id
    if (child.type === SelectContent) content = (child.props as { children?: ReactNode }).children
  })
  return (
    <select id={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {collect(content)}
    </select>
  )
}

/** Lifted onto the native select by `Select`; renders nothing itself. */
export function SelectTrigger(_: { id?: string; className?: string; children?: ReactNode }) {
  return null
}
export function SelectContent(_: { children?: ReactNode }) {
  return null
}
export function SelectGroup(_: { children?: ReactNode }) {
  return null
}
export function SelectLabel(_: { children?: ReactNode }) {
  return null
}
export function SelectItem(_: { value: string; disabled?: boolean; children?: ReactNode }) {
  return null
}
export function SelectValue() {
  return null
}
