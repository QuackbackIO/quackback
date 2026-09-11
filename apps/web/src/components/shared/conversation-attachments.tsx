import { PaperClipIcon } from '@heroicons/react/24/outline'
import { ZoomableImage } from '@/components/shared/zoomable-image'
import type { ConversationAttachment } from '@/lib/shared/conversation/types'
import { sanitizeImageUrl } from '@/lib/shared/utils/sanitize'

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Defense-in-depth: never render a javascript: (or other hostile) URL into
 * href/src. Image srcs use the same raster-data-URI policy as lift/sanitize
 * so a stored `data:image/png;...` that we lift onto attachments still shows.
 */
function isSafeAttachment(a: ConversationAttachment): boolean {
  if (a.contentType.startsWith('image/')) return sanitizeImageUrl(a.url).length > 0
  if (a.url.startsWith('/')) return true
  try {
    const proto = new URL(a.url).protocol
    return proto === 'https:' || proto === 'http:'
  } catch {
    return false
  }
}

/** Renders a message's attachments — images inline, other files as chips. */
export function ConversationAttachmentList({
  attachments,
}: {
  attachments: ConversationAttachment[]
}) {
  const safe = (attachments ?? []).filter(isSafeAttachment)
  if (safe.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {safe.map((a, i) =>
        a.contentType.startsWith('image/') ? (
          // Thumbnail under the message; click enlarges in a modal.
          <ZoomableImage
            key={i}
            src={a.url}
            alt={a.name}
            className="block w-fit overflow-hidden rounded-lg border border-border/40"
            thumbClassName="max-h-40 max-w-full w-auto h-auto object-contain"
          />
        ) : (
          <a
            key={i}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border/50 px-2 py-1 text-xs hover:bg-muted/40"
          >
            <PaperClipIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-[180px] truncate">{a.name || 'File'}</span>
            <span className="text-muted-foreground/60">{humanSize(a.size)}</span>
          </a>
        )
      )}
    </div>
  )
}
