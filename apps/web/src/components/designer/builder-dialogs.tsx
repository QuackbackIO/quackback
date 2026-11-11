import { lazy, Suspense, useState } from 'react'
import type { useDesignDraft } from '@/components/admin/settings/appearance/use-design-draft'
import { useOpenedOnce } from '@/lib/client/hooks/use-opened-once'
import type { FindItem, FindSource } from './find-index'
import { QuickFind, type FindNavigation } from './quick-find'
import { VersionsDialog } from './versions-dialog'

// Each loads the first time it opens, and stays mounted after, so closing can animate.
// Versions loads with the builder: its code shares a chunk with what Settings > Portal loads.
const SharePreviewDialog = lazy(() =>
  import('./share-preview').then((m) => ({ default: m.SharePreviewDialog }))
)
const ShortcutsDialog = lazy(() =>
  import('./shortcuts-dialog').then((m) => ({ default: m.ShortcutsDialog }))
)

type Dialog = 'versions' | 'find' | 'share' | 'keys'

/**
 * The builder's dialogs, opened from the draft status menu, the overview and
 * the keyboard: versions, find a setting, share a preview link, and the
 * keyboard shortcuts. None is drawn until it first opens; Share and Keys
 * load their code then too.
 */
export function useBuilderDialogs({
  draft,
  find,
  navigation,
  extra,
  actions,
}: {
  /** What quick find's index is built from. */
  find: FindSource
  /** How quick find gets to what was chosen. */
  navigation: FindNavigation
  /** More for quick find, such as the picked element's settings. */
  extra?: readonly FindItem[]
  /** Quick find's actions, read as it opens. */
  actions?: () => readonly FindItem[]
  draft: ReturnType<typeof useDesignDraft>
}) {
  const [open, setOpen] = useState<Dialog | null>(null)
  const set = (dialog: Dialog) => (shown: boolean) =>
    setOpen((now) => (shown ? dialog : now === dialog ? null : now))
  const keys = useOpenedOnce(open === 'keys')
  const share = useOpenedOnce(open === 'share')
  const versions = useOpenedOnce(open === 'versions')
  return {
    open,
    show: (dialog: Dialog) => setOpen(dialog),
    dialogs: (
      <>
        <QuickFind
          source={find}
          navigation={navigation}
          opened={open === 'find'}
          onOpened={set('find')}
          extra={extra}
          actions={actions}
        />
        <Suspense fallback={null}>
          {keys && <ShortcutsDialog open={open === 'keys'} onOpenChange={set('keys')} />}
          {share && (
            <SharePreviewDialog
              open={open === 'share'}
              onOpenChange={set('share')}
              flush={draft.flush}
            />
          )}
        </Suspense>
        {versions && (
          <VersionsDialog open={open === 'versions'} onOpenChange={set('versions')} draft={draft} />
        )}
      </>
    ),
  }
}
