/**
 * Nav/filter density tokens. These are back-compat aliases; the canonical
 * definitions now live in `@/components/ui/menu` (the Compact-tier density
 * module). Prefer importing MENU_ROW / MENU_ICON / MENU_LABEL directly for new
 * code — these NAV_* names are kept so existing nav/filter call sites keep working.
 */
export {
  MENU_ROW as NAV_ITEM_CLASS,
  MENU_ICON as NAV_ICON_CLASS,
  MENU_LABEL as NAV_SECTION_CLASS,
} from '@/components/ui/menu'
