import { PaperClipIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { ZoomableImage } from '@/components/shared/zoomable-image'
import type { ConversationAttachment } from '@/lib/shared/conversation/types'

/**
 * Pending-attachment tray for the conversation composer. Image attachments render as
 * thumbnails (click to zoom into a near-full-size modal); other files fall back
 * to a labelled chip. Each has a remove control. Rendered INSIDE the composer
 * input, below the editor, so it reads as part of the message being drafted.
 */
export function ComposerAttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: ConversationAttachment[]
  onRemove: (index: number) => void
}) {
  if (attachments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {attachments.map((a, i) => {
        const isImage = !!a.contentType?.startsWith('image/') && !!a.url
        return (
          <div key={i} className="group relative">
            {isImage ? (
              <ZoomableImage
                src={a.url}
                alt={a.name}
                className="block size-16 overflow-hidden rounded-md border border-border/60 bg-muted/30"
                thumbClassName="size-full object-cover"
              />
            ) : (
              <div className="flex h-16 w-28 items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 text-[11px]">
                <PaperClipIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{a.name || 'file'}</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label="Remove attachment"
              className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground"
            >
              <XMarkIcon className="h-3 w-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
