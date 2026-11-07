import { HistoryDialog } from '@/components/admin/settings/appearance/history-dialog'
import type { useDesignDraft } from '@/components/admin/settings/appearance/use-design-draft'
import { trackBuilder } from '@/lib/client/builder-events'
import { getPortalDesignVersionFn } from '@/lib/server/functions/portal-design'
import { replaceDesign } from '@/lib/shared/design/presets'

/** Versions: go back to a published one, or copy one into the draft. */
export function VersionsDialog({
  open,
  onOpenChange,
  draft,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: Pick<ReturnType<typeof useDesignDraft>, 'published' | 'restore' | 'update'>
}) {
  return (
    <HistoryDialog
      open={open}
      onOpenChange={onOpenChange}
      currentNumber={draft.published?.number ?? null}
      onRestore={async (revisionId) => {
        const outcome = await draft.restore(revisionId)
        if (outcome.ok) trackBuilder('designer_version_restored', { how: 'restore' })
        return outcome
      }}
      onCopy={async (revisionId, number) => {
        const found = await getPortalDesignVersionFn({ data: { revisionId } })
        if (!found.ok) return found
        draft.update((next) => replaceDesign(next, found.design), `Copy of version ${number}`)
        trackBuilder('designer_version_restored', { how: 'copy' })
        return { ok: true }
      }}
    />
  )
}
