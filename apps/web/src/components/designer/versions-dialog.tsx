import { HistoryDialog } from '@/components/admin/settings/appearance/history-dialog'
import type { useDesignDraft } from '@/components/admin/settings/appearance/use-design-draft'
import { trackBuilder } from '@/lib/client/builder-events'
import { getPortalDesignVersionFn } from '@/lib/server/functions/portal-design'
import { getPortalDesignCheckpointFn } from '@/lib/server/functions/portal-design-saved'
import { replaceDesign } from '@/lib/shared/design/presets'
import type { PortalDesign } from '@/lib/shared/design/schema'

/**
 * Versions: go back to a published one, or copy one, or an automatic save of
 * the draft, into the draft. The draft is saved aside before a copy replaces it.
 */
export function VersionsDialog({
  open,
  onOpenChange,
  draft,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: Pick<ReturnType<typeof useDesignDraft>, 'published' | 'restore' | 'update' | 'saveAside'>
}) {
  // The draft a copy replaces is saved aside on the server first.
  const copyIn = async (design: PortalDesign, label: string) => {
    await draft.saveAside('copy')
    draft.update((next) => replaceDesign(next, design), label)
  }
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
        await copyIn(found.design, `Copy of version ${number}`)
        trackBuilder('designer_version_restored', { how: 'copy' })
        return { ok: true }
      }}
      onCopySaved={async (id, name) => {
        const found = await getPortalDesignCheckpointFn({ data: { id } })
        if (!found.ok) return found
        await copyIn(found.design, `Copy of draft save: ${name}`)
        return { ok: true }
      }}
    />
  )
}
