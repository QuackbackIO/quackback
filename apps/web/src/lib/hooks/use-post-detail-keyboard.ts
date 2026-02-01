import { useEffect } from 'react'

interface UsePostDetailKeyboardOptions {
  /** Enable/disable keyboard handling */
  enabled?: boolean
  /** Navigate to next post (j key) */
  onNextPost?: () => void
  /** Navigate to previous post (k key) */
  onPrevPost?: () => void
  /** Close/back navigation (Escape key) */
  onClose?: () => void
  /** Open edit dialog (e key) */
  onEdit?: () => void
}

/**
 * Keyboard navigation for post detail view.
 *
 * Keys:
 * - j: Next post
 * - k: Previous post
 * - Escape: Close/back
 * - e: Edit post
 *
 * Ignores key events when focus is in input/textarea.
 */
export function usePostDetailKeyboard({
  enabled = true,
  onNextPost,
  onPrevPost,
  onClose,
  onEdit,
}: UsePostDetailKeyboardOptions): void {
  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key) {
        case 'j':
          if (onNextPost) {
            e.preventDefault()
            onNextPost()
          }
          break
        case 'k':
          if (onPrevPost) {
            e.preventDefault()
            onPrevPost()
          }
          break
        case 'Escape':
          if (onClose) {
            onClose()
          }
          break
        case 'e':
          if (onEdit) {
            e.preventDefault()
            onEdit()
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, onNextPost, onPrevPost, onClose, onEdit])
}
