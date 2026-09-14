import { useRouteContext } from '@tanstack/react-router'
import type { VisualTheme } from '@/lib/shared/labs'

export function useVisualTheme(): VisualTheme {
  const ctx = useRouteContext({ from: '__root__' }) as {
    visualTheme?: VisualTheme
    settings?: { visualTheme?: VisualTheme }
  }
  return ctx.visualTheme === 'refined' || ctx.settings?.visualTheme === 'refined'
    ? 'refined'
    : 'legacy'
}

export function useRefinedTheme(): boolean {
  return useVisualTheme() === 'refined'
}
