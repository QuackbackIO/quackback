import { designNavConfig } from '@/components/public/portal-header-nav'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { PortalNavItemConfig } from '@/lib/shared/types/settings'

type MenuItem = PortalDesign['nav']['items'][number]

/** The design's menu as the menu editor's rows. */
export function navEditorItems(nav: PortalDesign['nav']): PortalNavItemConfig[] {
  return designNavConfig(nav).items ?? []
}

/**
 * The editor's rows as the design's menu, or null while a link in them is not
 * whole: a name of up to 40 characters and an http(s) address.
 */
export function designNavItems(rows: PortalNavItemConfig[]): MenuItem[] | null {
  const items: MenuItem[] = []
  for (const row of rows) {
    const label = row.label?.trim() ?? ''
    if (row.type !== 'link') {
      items.push({ type: row.type, shown: row.enabled !== false, ...(label ? { label } : {}) })
      continue
    }
    const url = row.url?.trim() ?? ''
    if (!label || label.length > 40 || !/^https?:\/\/[^\s]+$/i.test(url)) return null
    items.push({ type: 'link', id: row.id, label, url, newTab: row.newTab ?? true })
  }
  return items
}
