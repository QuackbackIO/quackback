import type { WidgetCardAudience } from '@/lib/shared/types/settings'

/**
 * Whether a Home card is shown to the current visitor (visitor-vs-user content).
 * `everyone` (or unset) always shows; `anonymous` shows only to signed-out
 * visitors; `identified` shows only once the visitor has been identified. Pure
 * so the widget renderer and the admin preview share one rule.
 */
export function cardVisibleToVisitor(
  audience: WidgetCardAudience | undefined,
  isIdentified: boolean
): boolean {
  if (audience === 'anonymous') return !isIdentified
  if (audience === 'identified') return isIdentified
  return true
}
