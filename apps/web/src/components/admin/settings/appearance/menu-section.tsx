import { useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SettingRow } from '@/components/admin/settings/setting-row'
import { PortalNavEditor } from '@/components/admin/settings/branding/portal-nav-editor'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import type { PortalNavItemConfig } from '@/lib/shared/types/settings'
import { designNavItems, navEditorItems } from './menu-items'

type Update = (change: (draft: PortalDesign) => void) => void

/**
 * The menu: Home's tab while Home is on, then the pages and links in order,
 * each shown or hidden and renamed. The rows reach the draft once every link
 * in them is whole and, with Home off, they show a page to start on.
 */
export function MenuSection({
  design,
  update,
  gates,
}: {
  design: PortalDesign
  update: Update
  gates: PortalPageGates
}) {
  const { home, items } = design.nav
  const [rows, setRows] = useState(() => navEditorItems(design.nav))
  // The menu this section last wrote; a different one came from elsewhere,
  // such as Quackback AI or a discard, and replaces the rows.
  const written = useRef(items)
  useEffect(() => {
    if (JSON.stringify(items) === JSON.stringify(written.current)) return
    written.current = items
    setRows(navEditorItems(design.nav))
  }, [items, design.nav])
  const gated = useMemo(
    () =>
      new Set(
        (Object.keys(gates) as Array<keyof PortalPageGates>).filter((page) => !gates[page])
      ) as ReadonlySet<string>,
    [gates]
  )
  const next = designNavItems(rows)
  const noPage =
    next !== null && !home.on && !next.some((item) => item.type !== 'link' && item.shown)

  function change(nextRows: PortalNavItemConfig[]) {
    setRows(nextRows)
    const menu = designNavItems(nextRows)
    if (!menu) return
    if (!home.on && !menu.some((item) => item.type !== 'link' && item.shown)) return
    written.current = menu
    update((draft) => void (draft.nav.items = menu))
  }

  return (
    <section id="design-section-menu" className="scroll-mt-4 space-y-4">
      <h3 className="text-sm font-semibold">Menu</h3>
      {home.on && (
        <>
          <SettingRow
            label="Home in the menu"
            htmlFor="design-home-tab"
            control={
              <Switch
                id="design-home-tab"
                checked={home.tab}
                onCheckedChange={(tab) => update((draft) => void (draft.nav.home.tab = tab))}
              />
            }
          />
          {home.tab && (
            <div className="space-y-1.5">
              <label htmlFor="design-home-label" className="text-[13px] font-medium">
                Home tab name
              </label>
              <Input
                id="design-home-label"
                placeholder="Home"
                maxLength={40}
                value={home.label ?? ''}
                onChange={(event) =>
                  update((draft) => {
                    const label = event.target.value
                    if (label.trim()) draft.nav.home.label = label
                    else delete draft.nav.home.label
                  })
                }
              />
            </div>
          )}
        </>
      )}
      <PortalNavEditor
        items={rows}
        onChange={change}
        gatedTypes={gated}
        feedbackHideable
        onReset={() => change(navEditorItems(defaultDesign().nav))}
      />
      {noPage && (
        <p role="alert" className="text-xs text-muted-foreground">
          Show at least one page, or turn Home on.
        </p>
      )}
    </section>
  )
}
