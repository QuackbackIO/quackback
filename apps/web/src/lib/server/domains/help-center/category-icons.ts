/**
 * The icon names a help-center category can store and have drawn: the 20px
 * solid heroicons, the set the admin picker offers and CategoryIcon renders
 * (components/help-center/category-icon-map.ts, held equal by its MCP test).
 * Any other value, an emoji say, is drawn as the default folder.
 */
import * as solidIcons from '@heroicons/react/20/solid'

export const CATEGORY_ICON_NAMES: ReadonlySet<string> = new Set(
  Object.keys(solidIcons).filter((name) => /^[A-Z][A-Za-z0-9]*Icon$/.test(name))
)

export function isCategoryIconName(value: string): boolean {
  return CATEGORY_ICON_NAMES.has(value)
}
