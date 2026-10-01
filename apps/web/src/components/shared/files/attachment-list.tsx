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
import { useConversationGallery, isSafeAttachment } from './conversation-gallery'
import { toViewerFile, type ViewerFile } from './types'
import {
  FilePreviewCard,
  FileIconCard,
  FileRow,
  resolveFamily,
  hasPreviewWorthShowing,
} from './file-card'
import type { ConversationAttachment } from '@/lib/shared/conversation/types'

/** Image subtypes most browsers cannot decode in an `<img>`. BMP decodes
 *  natively everywhere, so it stays off this list. */
const UNDISPLAYABLE_IMAGE_TYPES = new Set(['image/tiff', 'image/heic', 'image/heif'])

/** An image attachment the browser cannot render inline, and for which the
 *  preview job hasn't produced a thumbnail or a browser-viewable rendition
 *  yet — it renders as a file card instead of a broken `<img>`. */
function isUndisplayableImage(a: ConversationAttachment): boolean {
  const contentType = a.contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!UNDISPLAYABLE_IMAGE_TYPES.has(contentType)) return false
  return !a.preview?.thumbUrl && !a.preview?.renditionUrl
}

/** The small thumbnail when there is one, else a browser-viewable rendition
 *  (HEIC/TIFF converted server-side), else the original — never the full
 *  original for a format that already has a lighter preview to show instead. */
function imageSrc(a: ConversationAttachment): string {
  return a.preview?.thumbUrl ?? a.preview?.renditionUrl ?? a.url
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
  /** This message is an internal note (admin thread only — notes never reach
   *  a visitor-facing DTO): attachments get the note's amber border so they
   *  read as not customer-visible, matching the note bubble's tint. */
  note?: boolean
}

export function AttachmentList({
  attachments,
  context = {},
  compact = false,
  align = 'start',
  note = false,
}: AttachmentListProps) {
  const { open } = useFileViewer()
  const gallery = useConversationGallery()

  const safe = (attachments ?? []).filter(isSafeAttachment)
  if (safe.length === 0) return null

  const images = safe.filter((a) => resolveFamily(a) === 'image' && !isUndisplayableImage(a))
  const files = safe.filter((a) => resolveFamily(a) !== 'image' || isUndisplayableImage(a))
  const noteTint = note ? 'border-amber-400/30 dark:border-amber-400/25' : undefined

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
        <ImageRow
          images={images}
          localIndexOf={localIndexOf}
          onOpen={openAt}
          compact={compact}
          note={note}
        />
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
                  className={cn(compact ? undefined : 'col-span-2', noteTint)}
                />
              )
            }
            if (compact) {
              return (
                <FileRow
                  key={localIndex}
                  attachment={a}
                  onOpen={() => openAt(localIndex)}
                  className={noteTint}
                />
              )
            }
            return hasPreviewWorthShowing(a) ? (
              <FilePreviewCard
                key={localIndex}
                attachment={a}
                onOpen={() => openAt(localIndex)}
                className={noteTint}
              />
            ) : (
              <FileIconCard
                key={localIndex}
                attachment={a}
                onOpen={() => openAt(localIndex)}
                className={noteTint}
              />
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
  note,
}: {
  images: ConversationAttachment[]
  localIndexOf: Map<ConversationAttachment, number>
  onOpen: (localIndex: number) => void
  compact: boolean
  note: boolean
}) {
  const intl = useIntl()
  const openLabel = (name: string) =>
    intl.formatMessage({ id: 'files.card.open', defaultMessage: 'Open {name}' }, { name })
  const noteTint = note ? 'border-amber-400/30 dark:border-amber-400/25' : undefined

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
          compact ? 'max-w-[200px]' : 'max-w-[248px]',
          noteTint
        )}
      >
        <img
          src={imageSrc(a)}
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
            className={cn(
              'aspect-square cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted',
              noteTint
            )}
          >
            <img src={imageSrc(a)} alt="" className="h-full w-full object-cover" />
          </button>
        )
      })}
    </div>
  )
}
