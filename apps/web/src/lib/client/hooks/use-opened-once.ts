import { useState } from 'react'

/**
 * True from the first render in which `open` is true, and from then on. Gate a
 * lazily loaded dialog or panel on it: its code loads the first time it opens,
 * and it stays mounted afterwards so closing can animate.
 */
export function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open)
  if (open && !opened) setOpened(true)
  return opened || open
}
