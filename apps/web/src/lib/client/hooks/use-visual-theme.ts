import { useRouteContext } from '@tanstack/react-router'
import type { VisualTheme } from '@/lib/shared/labs'

/** Selects the theme itself, so a navigation that leaves it alone renders nothing again. */
export function useVisualTheme(): VisualTheme {
  return useRouteContext({
    from: '__root__',
    select: (context) => {
      const ctx = context as {
        visualTheme?: VisualTheme
        settings?: { visualTheme?: VisualTheme }
      }
      return ctx.visualTheme === 'refined' || ctx.settings?.visualTheme === 'refined'
        ? 'refined'
        : 'legacy'
    },
  })
}

export function useRefinedTheme(): boolean {
  return useVisualTheme() === 'refined'
}
