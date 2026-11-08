import type { useDesignDraft } from '@/components/admin/settings/appearance/use-design-draft'
import { trackBuilder } from '@/lib/client/builder-events'
import { pageParts, type Sheet } from '@/lib/shared/design/builder-chrome'
import type { DesignCheck } from '@/lib/shared/design/checks'
import type { OutlineNode, Selection } from '@/lib/shared/design/outline'
import { BlocksMenu } from './blocks-menu'
import { DesignerHeader } from './designer-header'
import { DraftStatus } from './draft-status'
import { PageSwitcher } from './page-switcher'
import type { CanvasView } from './use-canvas-view'
import type { useDesignerPage } from './use-designer-page'
import { ViewMenu } from './view-menu'
import { ViewOptions, ZoomControl } from './view-options'
import type { PortalAddress } from '@/lib/shared/design/portal-address'

/**
 * The builder's top bar, wired: the page switcher and the blocks on the
 * page, the device, zoom and View, undo and redo, the draft's state with
 * what to check, Add, Theme, Preview and Publish.
 */
export function BuilderTopBar({
  returnPath,
  workspaceName,
  onExit,
  draft,
  view,
  canvas,
  nodes,
  selection,
  onPick,
  checks,
  onFixCheck,
  onUndo,
  onRedo,
  onTurnOn,
  sheet,
  onSheet,
  onPreview,
  onPublish,
  published,
  onPublishedClose,
  onDiscard,
  onDialog,
}: {
  returnPath: string
  workspaceName: string
  onExit: () => void
  draft: ReturnType<typeof useDesignDraft>
  view: ReturnType<typeof useDesignerPage>
  canvas: CanvasView
  /** The parts of the page shown, which the blocks menu lists. */
  nodes: readonly OutlineNode[]
  selection: Selection | null
  /** Picks a part and moves focus to its settings. */
  onPick: (selection: Selection) => void
  checks: readonly DesignCheck[]
  /** Makes a check's one-step fix. */
  onFixCheck: (check: DesignCheck) => void
  onUndo: () => void
  onRedo: () => void
  /** Turns a part on from the switcher, by way of the menu's "+". */
  onTurnOn: () => void
  sheet: Sheet | null
  onSheet: (sheet: Sheet) => void
  onPreview: () => void
  onPublish: () => void
  /** Where the portal just went live, shown on Publish until closed. */
  published?: PortalAddress | null
  onPublishedClose?: () => void
  onDiscard: () => void
  onDialog: (dialog: 'keys' | 'versions' | 'share' | 'find') => void
}) {
  const { design } = draft
  return (
    <DesignerHeader
      returnPath={returnPath}
      onExit={onExit}
      workspaceName={workspaceName}
      pagePicker={
        <PageSwitcher
          design={design}
          gates={view.gates}
          here={view.here}
          sample={view.sample}
          widget={view.widget}
          onPage={view.setPage}
          onSample={view.showSample}
          onWidget={view.showWidget}
          onTurnOn={onTurnOn}
        />
      }
      blocks={
        <BlocksMenu
          parts={pageParts(nodes)}
          picked={selection}
          onPick={onPick}
          blocks={design.pages.home.blocks}
        />
      }
      view={
        <ViewMenu zoom={<ZoomControl zoom={canvas.zoom} onZoom={canvas.setZoom} />}>
          <ViewOptions
            mode={design.mode}
            theme={canvas.theme}
            onTheme={canvas.setTheme}
            locale={canvas.locale}
            onLocale={canvas.setLocale}
            visitor={view.visitor}
            onVisitor={view.setVisitor}
            onKeys={() => onDialog('keys')}
          />
        </ViewMenu>
      }
      size={canvas.size}
      onSize={(next) => {
        canvas.setSize(next)
        trackBuilder('designer_device_switched', { device: next })
      }}
      undoLabel={draft.undoLabel}
      redoLabel={draft.redoLabel}
      onUndo={onUndo}
      onRedo={onRedo}
      draftStatus={
        <DraftStatus
          count={draft.changes.length}
          saving={draft.saving}
          failed={draft.failed}
          blocked={draft.conflict}
          published={!!draft.published}
          onSeeAll={onPublish}
          onDiscard={onDiscard}
          onVersions={() => onDialog('versions')}
          onShare={() => onDialog('share')}
          onFind={() => onDialog('find')}
          checks={checks}
          onShowCheck={onPick}
          onFixCheck={onFixCheck}
        />
      }
      sheet={sheet}
      onSheet={onSheet}
      onPreview={onPreview}
      onPublish={onPublish}
      published={published}
      onPublishedClose={onPublishedClose}
      canPublish={draft.canPublish}
      changes={draft.changes.length}
    />
  )
}
