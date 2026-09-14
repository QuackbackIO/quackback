import type { VisualTheme } from './types'

export const VISUAL_THEME_ATTR = 'data-visual-theme'
export const REFINED_THEME_VALUE = 'refined'

export function visualThemeAttribute(
  theme: VisualTheme | null | undefined
): typeof REFINED_THEME_VALUE | undefined {
  return theme === 'refined' ? REFINED_THEME_VALUE : undefined
}

export function applyVisualThemeToDocument(theme: VisualTheme | null | undefined): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (theme === 'refined') {
    root.setAttribute(VISUAL_THEME_ATTR, REFINED_THEME_VALUE)
  } else {
    root.removeAttribute(VISUAL_THEME_ATTR)
  }
}
