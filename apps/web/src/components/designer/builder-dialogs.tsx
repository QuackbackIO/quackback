import { useState } from 'react'
import type { useDesignDraft } from '@/components/admin/settings/appearance/use-design-draft'
import type { DesignerPage, OutlineNode, Selection } from '@/lib/shared/design/outline'
import type { FindItem } from '@/lib/shared/design/quick-find'
import { QuickFind } from './quick-find'
import { SharePreviewDialog } from './share-preview'
import { ShortcutsDialog } from './shortcuts-dialog'
import { VersionsDialog } from './versions-dialog'

type Dialog = 'versions' | 'find' | 'share' | 'keys'

/**
 * The builder's dialogs, opened from the draft status menu, the overview and
 * the keyboard: versions, find a setting, share a preview link, and the
 * keyboard shortcuts.
 */
export function useBuilderDialogs({
  draft,
  nodes,
  page,
  pages,
  onSelect,
  onPage,
  extra,
  actions,
}: {
  /** More for quick find, such as the picked element's settings. */
  extra?: readonly FindItem[]
  /** Quick find's actions, read as it opens. */
  actions?: () => readonly FindItem[]
  draft: ReturnType<typeof useDesignDraft>
  nodes: readonly OutlineNode[]
  page: DesignerPage
  pages: readonly DesignerPage[]
  onSelect: (selection: Selection) => void
  onPage: (page: DesignerPage) => void
}) {
  const [open, setOpen] = useState<Dialog | null>(null)
  const set = (dialog: Dialog) => (shown: boolean) =>
    setOpen((now) => (shown ? dialog : now === dialog ? null : now))
  return {
    open,
    show: (dialog: Dialog) => setOpen(dialog),
    dialogs: (
      <>
        <ShortcutsDialog open={open === 'keys'} onOpenChange={set('keys')} />
        <QuickFind
          nodes={nodes}
          page={page}
          pages={pages}
          onSelect={onSelect}
          onPage={onPage}
          opened={open === 'find'}
          onOpened={set('find')}
          extra={extra}
          design={draft.design}
          actions={actions}
        />
        <SharePreviewDialog
          open={open === 'share'}
          onOpenChange={set('share')}
          flush={draft.flush}
        />
        <VersionsDialog open={open === 'versions'} onOpenChange={set('versions')} draft={draft} />
      </>
    ),
  }
}
