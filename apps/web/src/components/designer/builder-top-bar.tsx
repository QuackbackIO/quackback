import { memo, useCallback, useMemo } from 'react'
import { trackBuilder } from '@/lib/client/builder-events'
import type { Sheet } from '@/lib/shared/design/builder-chrome'
import type { DesignCheck } from '@/lib/shared/design/checks'
import type { CanvasLocation, Selection } from '@/lib/shared/design/outline'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { SamplePage } from '@/lib/shared/design/sample-pages'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { CanvasVisitor } from '@/lib/shared/design/designer-frame'
import { DesignerHeader } from './designer-header'
import { DraftStatus } from './draft-status'
import { PageSwitcher } from './page-switcher'
import type { CanvasView } from './use-canvas-view'
import type { useDesignerPage } from './use-designer-page'
import { ViewMenu } from './view-menu'
import { ViewOptions, ZoomControl } from './view-options'
import type { PortalAddress } from '@/lib/shared/design/portal-address'

type DesignerView = ReturnType<typeof useDesignerPage>

/** What the top bar shows of the draft: its state, never the design itself. */
export interface TopBarDraft {
  undoLabel: string | null
  redoLabel: string | null
  /** How many changes the draft holds. */
  changes: number
  saving: boolean
  failed: boolean
  conflict: boolean
  /** Whether the portal has been published before. */
  published: boolean
  canPublish: boolean
}

/**
 * The builder's top bar, wired: the page switcher, the device, zoom and View, undo and redo, the draft's state with
 * what to check, Add, Theme, Preview and Publish. It reads only what it shows, the menu and not
 * the whole design, so a change elsewhere in the design leaves it as it is. Its handlers are
 * to keep their identity (see useSteadyHandlers), or it draws again on every change.
 */
export const BuilderTopBar = memo(function BuilderTopBar({
  returnPath,
  workspaceName,
  onExit,
  draft,
  nav,
  mode,
  gates,
  here,
  sample,
  widget,
  visitor,
  setPage,
  showSample,
  showWidget,
  setVisitor,
  canvas,
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
  draft: TopBarDraft
  /** The design's menu, which names the pages; held as `{ nav }`, the same object while it is the same. */
  nav: Pick<PortalDesign, 'nav'>
  mode: PortalDesign['mode']
  gates: PortalPageGates
  here: CanvasLocation
  sample: SamplePage | null
  widget: boolean
  visitor: CanvasVisitor
  setPage: DesignerView['setPage']
  showSample: DesignerView['showSample']
  showWidget: DesignerView['showWidget']
  setVisitor: DesignerView['setVisitor']
  canvas: CanvasView
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
  const keys = useCallback(() => onDialog('keys'), [onDialog])
  const versions = useCallback(() => onDialog('versions'), [onDialog])
  const share = useCallback(() => onDialog('share'), [onDialog])
  const find = useCallback(() => onDialog('find'), [onDialog])
  const { setSize } = canvas
  const size = useCallback(
    (next: CanvasView['size']) => {
      setSize(next)
      trackBuilder('designer_device_switched', { device: next })
    },
    [setSize]
  )
  // Each part made only when what it shows changes, so a new undo label draws the undo button alone.
  const pagePicker = useMemo(
    () => (
      <PageSwitcher
        design={nav}
        gates={gates}
        here={here}
        sample={sample}
        widget={widget}
        onPage={setPage}
        onSample={showSample}
        onWidget={showWidget}
        onTurnOn={onTurnOn}
      />
    ),
    [nav, gates, here, sample, widget, setPage, showSample, showWidget, onTurnOn]
  )
  const { zoom, setZoom, theme, setTheme, locale, setLocale } = canvas
  const view = useMemo(
    () => (
      <ViewMenu zoom={<ZoomControl zoom={zoom} onZoom={setZoom} />}>
        <ViewOptions
          mode={mode}
          theme={theme}
          onTheme={setTheme}
          locale={locale}
          onLocale={setLocale}
          visitor={visitor}
          onVisitor={setVisitor}
          onKeys={keys}
        />
      </ViewMenu>
    ),
    [zoom, setZoom, mode, theme, setTheme, locale, setLocale, visitor, setVisitor, keys]
  )
  const { changes, saving, failed, conflict } = draft
  const status = useMemo(
    () => (
      <DraftStatus
        count={changes}
        saving={saving}
        failed={failed}
        blocked={conflict}
        published={draft.published}
        onSeeAll={onPublish}
        onDiscard={onDiscard}
        onVersions={versions}
        onShare={share}
        onFind={find}
        checks={checks}
        onShowCheck={onPick}
        onFixCheck={onFixCheck}
      />
    ),
    [
      changes,
      saving,
      failed,
      conflict,
      draft.published,
      onPublish,
      onDiscard,
      versions,
      share,
      find,
      checks,
      onPick,
      onFixCheck,
    ]
  )
  return (
    <DesignerHeader
      returnPath={returnPath}
      onExit={onExit}
      workspaceName={workspaceName}
      pagePicker={pagePicker}
      view={view}
      size={canvas.size}
      onSize={size}
      undoLabel={draft.undoLabel}
      redoLabel={draft.redoLabel}
      onUndo={onUndo}
      onRedo={onRedo}
      draftStatus={status}
      sheet={sheet}
      onSheet={onSheet}
      onPreview={onPreview}
      onPublish={onPublish}
      published={published}
      onPublishedClose={onPublishedClose}
      canPublish={draft.canPublish}
      changes={changes}
    />
  )
})
