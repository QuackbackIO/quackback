import { useEffect, useReducer, useRef } from 'react'
import { trackBuilder } from '@/lib/client/builder-events'
import { NO_SHEET, panelReducer, type Sheet } from '@/lib/shared/design/builder-chrome'

/** Hands focus back to the top bar button that opened a sheet. */
const focusButton = (sheet: Sheet) =>
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>(`[data-sheet-button="${sheet}"]`)?.focus()
  )

/**
 * The sheet open over the right panel, Theme or Add, and whether Theme opens
 * at its Style. Each opening is counted; closing hands focus back to the
 * button that opened it, while "Back to <pick>" leaves it in the panel.
 */
export function useBuilderPanel() {
  const [state, dispatch] = useReducer(panelReducer, NO_SHEET)
  const seen = useRef(state)
  useEffect(() => {
    const before = seen.current
    seen.current = state
    if (state.sheet && state.sheet !== before.sheet)
      trackBuilder('designer_panel_opened', { panel: state.sheet })
    if (state.more && !before.more) trackBuilder('designer_panel_opened', { panel: 'theme_more' })
  }, [state])
  const close = () => {
    if (state.sheet) focusButton(state.sheet)
    dispatch({ type: 'close' })
  }
  return { state, dispatch, close }
}
