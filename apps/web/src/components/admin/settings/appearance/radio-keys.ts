import type { KeyboardEvent } from 'react'

/**
 * Arrow keys in a group of radio buttons move to the next one and pick it,
 * as a radio group does: the group is one Tab stop, the picked option.
 */
export function onRadioKeys(event: KeyboardEvent<HTMLElement>) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
  if (!step) return
  const radios = [
    ...event.currentTarget.querySelectorAll<HTMLElement>('[role=radio]:not(:disabled)'),
  ]
  const at = radios.findIndex((radio) => radio === document.activeElement)
  if (at < 0) return
  event.preventDefault()
  const next = radios[(at + step + radios.length) % radios.length]!
  next.focus()
  next.click()
}

/** The one option of a radio group that takes Tab: the picked one, else the first. */
export const radioTabIndex = (checked: boolean, noneChecked: boolean, index: number) =>
  checked || (noneChecked && index === 0) ? 0 : -1
