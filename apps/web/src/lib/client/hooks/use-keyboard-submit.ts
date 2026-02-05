import { useCallback } from 'react'

/**
 * Returns a keyboard event handler that calls `onSubmit` when Cmd/Ctrl + Enter is pressed.
 * Optionally calls `onCancel` when Escape is pressed.
 */
export function useKeyboardSubmit(onSubmit: () => void, onCancel?: () => void) {
  return useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        onSubmit()
      }
      if (e.key === 'Escape' && onCancel) {
        e.preventDefault()
        onCancel()
      }
    },
    [onSubmit, onCancel]
  )
}
