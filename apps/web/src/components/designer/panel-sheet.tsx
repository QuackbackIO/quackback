import type { CssWarning } from '@/components/admin/settings/appearance/css-section'
import type { PanelAction, PanelState, PanelView } from '@/lib/shared/design/builder-chrome'
import type { HomeBlockType } from '@/lib/shared/design/home'
import type { PageGateSettings, PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { StyleOverride } from '@/lib/shared/design/style-overrides'
import { AddContent } from './add-sheet'
import { BuilderSheet } from './builder-sheet'
import { ThemeContent } from './theme-sheet'
import type { AddDrag } from './use-add-drag'

/** The sheet open over the right panel, Theme or Add, with its way back and close. */
export function PanelSheet({
  shown,
  state,
  dispatch,
  onClose,
  design,
  update,
  gates,
  settings,
  logoUrl,
  cssWarnings,
  pickedBlock,
  onHome,
  page = null,
  onAdd,
  drag,
  onOverride,
  onBlock,
  onLogo,
  phone = false,
  onPhone,
}: {
  /** Whether the canvas shows a phone, which Theme's element panels follow. */
  phone?: boolean
  onPhone?: (phone: boolean) => void
  /** Picks the logo on the page, from the brand kit's Size and placement. */
  onLogo?: () => void
  /** Picks an override's element on the canvas. */
  onOverride?: (o: StyleOverride) => void
  /** Picks a Home block, from Theme's places set differently. */
  onBlock?: (blockId: string) => void
  shown: PanelView
  state: PanelState
  dispatch: (action: PanelAction) => void
  onClose: () => void
  design: PortalDesign
  update: (change: (draft: PortalDesign) => void, label?: string) => void
  gates: PortalPageGates
  /** What says where a page that is off is turned on, for Add. */
  settings?: PageGateSettings | null
  logoUrl: string | null
  cssWarnings: readonly CssWarning[]
  /** The picked block's name, which Add puts a new block under. */
  pickedBlock: string | null
  /** Whether Home is the page shown. */
  onHome: boolean
  /** The page shown, whose own background Theme can set. */
  page?: string | null
  onAdd: (type: HomeBlockType) => void
  /** Dragging a block from Add onto the page. */
  drag?: Pick<AddDrag, 'press'>
}) {
  if (!shown.sheet) return null
  return (
    <BuilderSheet
      id={`designer-sheet-${shown.sheet}`}
      title={shown.title ?? ''}
      back={shown.back}
      onBack={() => dispatch({ type: 'back' })}
      onClose={onClose}
    >
      {shown.sheet === 'theme' ? (
        <ThemeContent
          design={design}
          update={update}
          gates={gates}
          logoUrl={logoUrl}
          cssWarnings={cssWarnings}
          more={state.more}
          at={state.at}
          page={page}
          phone={phone}
          onPhone={onPhone}
          onOverride={onOverride}
          onBlock={onBlock}
          onLogo={onLogo}
        />
      ) : (
        <AddContent
          design={design}
          update={update}
          gates={gates}
          settings={settings}
          after={pickedBlock}
          onHome={onHome}
          onAdd={onAdd}
          drag={drag}
        />
      )}
    </BuilderSheet>
  )
}
