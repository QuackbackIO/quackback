import type { ReactNode } from 'react'
import type { StyleOverride } from '@/lib/shared/design/style-overrides'
import type { CssWarning } from '@/components/admin/settings/appearance/css-section'
import type { PanelAction, PanelState, PanelView } from '@/lib/shared/design/builder-chrome'
import type { DesignCheck } from '@/lib/shared/design/checks'
import type { HomeBlockType } from '@/lib/shared/design/home'
import type { DesignerPage, OutlineNode, Selection } from '@/lib/shared/design/outline'
import type { PanelRoute } from '@/lib/shared/design/panel-routes'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { PanelSheet } from './panel-sheet'
import { PickedSettings } from './picked-settings'
import { RightPanel } from './right-panel'
import type { AddDrag } from './use-add-drag'
import type { MenuEditing } from './use-menu-editing'

/** Changes the draft under a name, so undo says what it takes back. */
type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

/**
 * The builder's right column, the properties: the page's own panel with
 * nothing picked, else the picked part's, with Theme or Add as a sheet over
 * them. Closed only once Escape has closed the page's panel.
 */
export function BuilderSettings({
  hidden,
  open,
  shown,
  route,
  panel,
  selection,
  page,
  pages,
  nodes,
  design,
  update,
  gates,
  phone,
  onPhone,
  locale,
  checks,
  logoUrl,
  cssWarnings,
  menu,
  pickedBlock,
  onSelect,
  onAdd,
  drag,
  onTheme,
  say,
  element,
  onOverride,
  onBlock,
}: {
  /** Picks an override's element on the canvas. */
  onOverride?: (o: StyleOverride) => void
  /** Picks a Home block, from Theme's places set differently. */
  onBlock?: (blockId: string) => void
  /** The settings of an element picked in a block, in place of the block's. */
  element?: ReactNode
  /** Out of view in a narrow window while another column shows. */
  hidden: boolean
  /** Whether the panel is open: always, unless Escape closed the page's panel. */
  open: boolean
  shown: PanelView
  /** What the panel shows for the pick, from the route table. */
  route: PanelRoute
  panel: { state: PanelState; dispatch: (action: PanelAction) => void; close: () => void }
  selection: Selection | null
  page: DesignerPage
  /** How many pages the builder shows. */
  pages: number
  nodes: readonly OutlineNode[]
  design: PortalDesign
  update: NamedUpdate
  gates: PortalPageGates
  locale: string
  /** Whether the canvas shows a phone. */
  phone: boolean
  /** Shows the canvas as a phone, or on every screen. */
  onPhone?: (phone: boolean) => void
  /** What the checks found, shown in the panel of the block each belongs to. */
  checks: readonly DesignCheck[]
  logoUrl: string | null
  cssWarnings: readonly CssWarning[]
  menu: MenuEditing
  /** The picked block's name, which Add puts a new block under. */
  pickedBlock: string | null
  onSelect: (selection: Selection | null) => void
  onAdd: (type: HomeBlockType) => void
  /** Dragging a block from Add onto the page. */
  drag?: Pick<AddDrag, 'press'>
  onTheme: (more?: boolean) => void
  say: (words: string) => void
}) {
  return (
    <RightPanel
      open={open}
      hidden={hidden}
      showing={element ? 'element' : (selection ?? 'page')}
      sheet={
        shown.sheet && (
          <PanelSheet
            key={shown.sheet}
            shown={shown}
            state={panel.state}
            dispatch={panel.dispatch}
            onClose={panel.close}
            design={design}
            update={update}
            gates={gates}
            logoUrl={logoUrl}
            cssWarnings={cssWarnings}
            pickedBlock={pickedBlock}
            onHome={page === 'home'}
            page={page}
            onAdd={onAdd}
            drag={drag}
            onOverride={onOverride}
            onBlock={onBlock}
          />
        )
      }
    >
      {element ?? (
        <PickedSettings
          route={route}
          selection={selection}
          page={page}
          pages={pages}
          nodes={nodes}
          design={design}
          update={update}
          gates={gates}
          locale={locale}
          phone={phone}
          onPhone={onPhone}
          checks={checks}
          menu={menu}
          onSelect={onSelect}
          onTheme={onTheme}
          say={say}
        />
      )}
    </RightPanel>
  )
}
