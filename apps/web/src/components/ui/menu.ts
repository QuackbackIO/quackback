/**
 * Density tokens for menus, filters, and list chrome — the Compact tier of the
 * app-wide sizing standard (13px body text, 16px icons, 11px labels). See
 * MENU-FILTER-SIZING-STANDARD.md. Import these instead of hand-writing class
 * strings so the scale stays consistent and can be tuned in one place.
 *
 * Weight convention: rows sit at normal weight; the active/selected row appends
 * `font-medium` so weight (not just color) signals state.
 */

/** A menu / dropdown / filter / nav row (icon + label). Callers append active colors + `font-medium`. */
export const MENU_ROW =
  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-normal transition-colors'

/** Leading icon paired with a MENU_ROW. */
export const MENU_ICON = 'size-4 shrink-0'

/** Affordance icon (chevron, check, disclosure) in a row or control. */
export const MENU_AFFORDANCE = 'size-3.5 shrink-0'

/** A section subheading / eyebrow label in a menu or filter pane. */
export const MENU_LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'
