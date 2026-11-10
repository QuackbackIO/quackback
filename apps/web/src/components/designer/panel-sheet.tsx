import type { CssWarning } from '@/components/admin/settings/appearance/css-section'
import type { PanelAction, PanelState, PanelView } from '@/lib/shared/design/builder-chrome'
import type { HomeBlockType } from '@/lib/shared/design/home'
import type { PortalPageGates } from '@/lib/shared/design/paths'
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
  logoUrl,
  cssWarnings,
  pickedBlock,
  onHome,
  page = null,
  onAdd,
  drag,
  onOverride,
  onBlock,
}: {
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
          onMore={(open) => dispatch({ type: 'more', open })}
          page={page}
          onOverride={onOverride}
          onBlock={onBlock}
        />
      ) : (
        <AddContent
          design={design}
          update={update}
          gates={gates}
          after={pickedBlock}
          onHome={onHome}
          onAdd={onAdd}
          drag={drag}
        />
      )}
    </BuilderSheet>
  )
}
