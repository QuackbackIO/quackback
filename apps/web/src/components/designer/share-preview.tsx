import { useState } from 'react'
import { LocalDate } from '@/components/ui/local-date'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { PortalDesignPreviewId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { portalDesignQueries } from '@/lib/client/queries/portal-design'
import { trackBuilder } from '@/lib/client/builder-events'
import { PREVIEW_LINK_DAYS } from '@/lib/shared/design/preview-link'
import {
  createPortalDesignPreviewLinkFn,
  revokePortalDesignPreviewLinkFn,
} from '@/lib/server/functions/portal-design-preview'

async function copy(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    return false
  }
}

/**
 * A link that shows the draft, as it is now, to someone without admin access,
 * and the live links with a way to revoke each. The draft is saved first, so
 * the link holds the latest change. Opened from the builder's More menu.
 */
export function SharePreviewDialog({
  open,
  onOpenChange,
  flush,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  flush: () => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm space-y-1">
        <DialogHeader>
          <DialogTitle>Share a preview link</DialogTitle>
          <DialogDescription>
            Anyone with the link sees this draft as it is now, for {PREVIEW_LINK_DAYS} days.
          </DialogDescription>
        </DialogHeader>
        <ShareLinks open={open} flush={flush} />
      </DialogContent>
    </Dialog>
  )
}

/** Making a link, copying it, and the live links with a way to revoke each. */
function ShareLinks({ open, flush }: { open: boolean; flush: () => Promise<void> }) {
  const queryClient = useQueryClient()
  const [made, setMade] = useState<{ id: PortalDesignPreviewId; url: string } | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const links = useQuery({ ...portalDesignQueries.previewLinks(), enabled: open })
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: portalDesignQueries.previewLinks().queryKey })

  const create = async () => {
    setBusy(true)
    setRefusal(null)
    try {
      await flush()
      const result = await createPortalDesignPreviewLinkFn()
      if (!result.ok) return setRefusal(result.message)
      setMade({ id: result.link.id, url: result.url })
      trackBuilder('designer_preview_link_shared', {})
      if (await copy(result.url)) toast.success('Link copied')
      await refresh()
    } catch {
      setRefusal('The link could not be made. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: PortalDesignPreviewId) => {
    const result = await revokePortalDesignPreviewLinkFn({ data: { id } })
    if (!result.ok) toast.error(result.message)
    if (made?.id === id) setMade(null)
    await refresh()
  }

  return (
    <div className="space-y-3">
      {made ? (
        <div className="flex gap-2">
          <Input
            readOnly
            value={made.url}
            aria-label="Preview link"
            className="ph-mask h-8 text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (await copy(made.url)) toast.success('Link copied')
            }}
          >
            Copy
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" disabled={busy} onClick={create}>
          Create link
        </Button>
      )}
      {refusal && <p className="text-xs text-destructive">{refusal}</p>}
      {!!links.data?.length && (
        <ul className="space-y-1 border-t border-border pt-2" aria-label="Live links">
          {links.data.map((link) => (
            <li key={link.id} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                Expires{' '}
                <LocalDate date={link.expiresAt} options={{ day: 'numeric', month: 'short' }} />
                {link.createdBy && ` · by ${link.createdBy}`}
              </span>
              <Button variant="ghost" size="sm" onClick={() => revoke(link.id)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
