/**
 * A message's attachments, rendered below the bubble fill: images first as a
 * thumbnail row, then every other file as a card — a preview card once the
 * server's preview job has something to show, an icon card otherwise, or a
 * compact row on narrow surfaces (the widget). Replaces the old
 * `ConversationAttachmentList` (components/shared/conversation-attachments.tsx),
 * which only ever rendered images and a bare paperclip chip.
 *
 * Clicking any image or card opens the shared file viewer on the WHOLE
 * conversation's gallery (`useConversationGallery`), not just this message's
 * own attachments, so the viewer's arrow keys move through every file in the
 * thread. Outside a `ConversationGalleryProvider` (an isolated render, e.g. a
 * unit test) it falls back to a gallery of just this message's attachments.
 */
import { useIntl } from 'react-intl'
import { cn } from '@/lib/shared/utils/cn'
import { useFileViewer } from './file-viewer-context'
import { useConversationGallery } from './conversation-gallery'
import { toViewerFile, type ViewerFile } from './types'
import {
  FilePreviewCard,
  FileIconCard,
  FileRow,
  resolveFamily,
  hasPreviewWorthShowing,
} from './file-card'
import type { ConversationAttachment } from '@/lib/shared/conversation/types'
import { sanitizeImageUrl } from '@/lib/shared/utils/sanitize'

/**
 * Defense-in-depth: never render a javascript: (or other hostile) URL into
 * href/src. Image srcs use the same raster-data-URI policy as lift/sanitize
 * so a stored `data:image/png;...` that we lift onto attachments still shows.
 * Carried over from the component this replaces.
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

export interface AttachmentListContext {
  senderName?: string
  sentAt?: string
  messageId?: string
}

export interface AttachmentListProps {
  attachments: ConversationAttachment[]
  context?: AttachmentListContext
  /** Narrow surfaces (the widget): non-image, non-video files render as a
   *  compact row instead of a card. */
  compact?: boolean
  /** The side of the thread the message sits on; attachments line up with it. */
  align?: 'start' | 'end'
}

export function AttachmentList({
  attachments,
  context = {},
  compact = false,
  align = 'start',
}: AttachmentListProps) {
  const { open } = useFileViewer()
  const gallery = useConversationGallery()

  const safe = (attachments ?? []).filter(isSafeAttachment)
  if (safe.length === 0) return null

  const images = safe.filter((a) => resolveFamily(a) === 'image')
  const files = safe.filter((a) => resolveFamily(a) !== 'image')

  const openAt = (localIndex: number) => {
    const globalIndex = context.messageId ? gallery.indexOf(context.messageId, localIndex) : -1
    if (globalIndex >= 0 && gallery.files.length > 0) {
      open(gallery.files, globalIndex)
      return
    }
    // No (matching) gallery in context: fall back to a gallery of just this
    // message's own attachments, in the order they render.
    const fallback: ViewerFile[] = safe.map((a, i) =>
      toViewerFile(a, {
        senderName: context.senderName,
        sentAt: context.sentAt,
        messageId: context.messageId,
        index: i,
      })
    )
    open(fallback, localIndex)
  }

  // Local index of each attachment within `safe` (the order `openAt` and the
  // fallback gallery both use), kept stable across the images/files split.
  const localIndexOf = new Map(safe.map((a, i) => [a, i]))

  return (
    <div
      className={cn(
        'mt-1.5 flex w-full max-w-[520px] flex-col gap-2',
        align === 'end' ? 'items-end' : 'items-start'
      )}
    >
      {images.length > 0 && (
        <ImageRow images={images} localIndexOf={localIndexOf} onOpen={openAt} compact={compact} />
      )}
      {files.length > 0 && (
        <div
          className={
            compact
              ? 'flex w-full max-w-[280px] flex-col gap-1.5'
              : 'grid grid-cols-[repeat(2,minmax(0,248px))] gap-2'
          }
        >
          {files.map((a) => {
            const localIndex = localIndexOf.get(a)!
            const family = resolveFamily(a)
            const video = family === 'video'
            if (video) {
              return (
                <FilePreviewCard
                  key={localIndex}
                  attachment={a}
                  onOpen={() => openAt(localIndex)}
                  wide
                  className={compact ? undefined : 'col-span-2'}
                />
              )
            }
            if (compact) {
              return <FileRow key={localIndex} attachment={a} onOpen={() => openAt(localIndex)} />
            }
            return hasPreviewWorthShowing(a) ? (
              <FilePreviewCard key={localIndex} attachment={a} onOpen={() => openAt(localIndex)} />
            ) : (
              <FileIconCard key={localIndex} attachment={a} onOpen={() => openAt(localIndex)} />
            )
          })}
        </div>
      )}
    </div>
  )
}

function ImageRow({
  images,
  localIndexOf,
  onOpen,
  compact,
}: {
  images: ConversationAttachment[]
  localIndexOf: Map<ConversationAttachment, number>
  onOpen: (localIndex: number) => void
  compact: boolean
}) {
  const intl = useIntl()
  const openLabel = (name: string) =>
    intl.formatMessage({ id: 'files.card.open', defaultMessage: 'Open {name}' }, { name })

  if (images.length === 1) {
    const a = images[0]!
    const localIndex = localIndexOf.get(a)!
    return (
      <button
        type="button"
        onClick={() => onOpen(localIndex)}
        aria-label={openLabel(a.name || 'image')}
        className={cn(
          'block w-fit cursor-zoom-in overflow-hidden rounded-[10px] border border-border bg-muted',
          compact ? 'max-w-[200px]' : 'max-w-[248px]'
        )}
      >
        <img
          src={a.url}
          alt=""
          className={cn('block w-full object-contain', compact ? 'max-h-60' : 'max-h-80')}
        />
      </button>
    )
  }
  return (
    <div className="grid w-full max-w-[248px] grid-cols-2 gap-1.5">
      {images.map((a) => {
        const localIndex = localIndexOf.get(a)!
        return (
          <button
            key={localIndex}
            type="button"
            onClick={() => onOpen(localIndex)}
            aria-label={openLabel(a.name || 'image')}
            className="aspect-square cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted"
          >
            <img src={a.url} alt="" className="h-full w-full object-cover" />
          </button>
        )
      })}
    </div>
  )
}
