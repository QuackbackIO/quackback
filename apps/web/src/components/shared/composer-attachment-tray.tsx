import { useIntl, type IntlShape } from 'react-intl'
import { XMarkIcon } from '@heroicons/react/24/solid'
import { FileBadge } from '@/components/shared/files/file-badge'
import { useFileViewer } from '@/components/shared/files/file-viewer-context'
import { toViewerFile } from '@/components/shared/files/types'
import { formatBytes, maxBytesForFamily } from '@/lib/shared/files/file-types'
import { MAX_CONVERSATION_ATTACHMENTS } from '@/lib/shared/conversation/types'
import { cn } from '@/lib/shared/utils/cn'
import type { ComposerAttachmentItem } from '@/lib/client/hooks/use-conversation-composer-attachments'

interface TileProps {
  item: ComposerAttachmentItem
  onRemove: (localId: string) => void
  onRetry: (localId: string) => void
  /** Opens the shared file viewer on this tile, once it's ready — absent for
   *  the uploading/failed states, which have nothing to view yet. */
  onOpen?: (item: ComposerAttachmentItem) => void
}

/**
 * Maps a tile's `errorReason` to a localized message. Falls back to the raw
 * `error` text (the server's message, or a generic "Upload failed") for a
 * transient failure or a reason this tray doesn't have a translation for —
 * see `UploadError` in `lib/client/files/upload-file.ts`.
 */
function localizedError(item: ComposerAttachmentItem, intl: IntlShape): string {
  switch (item.errorReason) {
    case 'empty':
      return intl.formatMessage({
        id: 'files.upload.error.empty',
        defaultMessage: 'The file is empty',
      })
    case 'too_large': {
      const mb = Math.round(maxBytesForFamily(item.family) / (1024 * 1024))
      return intl.formatMessage(
        { id: 'files.upload.error.tooLarge', defaultMessage: 'Over {size} MB' },
        { size: intl.formatNumber(mb) }
      )
    }
    case 'blocked':
      return intl.formatMessage({
        id: 'files.upload.error.blocked',
        defaultMessage: "This file type can't be sent",
      })
    case 'rate_limited':
      return intl.formatMessage({
        id: 'files.upload.error.rateLimited',
        defaultMessage: 'Too many uploads. Try again in a minute.',
      })
    case 'cap':
      return intl.formatMessage(
        { id: 'files.tray.capReached', defaultMessage: 'You can attach up to {max} files' },
        { max: MAX_CONVERSATION_ATTACHMENTS }
      )
    default:
      return item.error ?? ''
  }
}

function RemoveButton({ item, onRemove }: Omit<TileProps, 'onRetry'>) {
  const intl = useIntl()
  return (
    <button
      type="button"
      onClick={() => onRemove(item.localId)}
      aria-label={intl.formatMessage(
        { id: 'files.tray.remove', defaultMessage: 'Remove {name}' },
        { name: item.name || 'file' }
      )}
      className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground"
    >
      <XMarkIcon className="h-3 w-3" />
    </button>
  )
}

/** Visually-hidden, announced once per tile (the visible progress bar itself
 *  stays `aria-hidden`, since a screen reader re-announcing a changing
 *  percentage would be far too chatty). */
function UploadingAnnouncement({ name }: { name: string }) {
  const intl = useIntl()
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {intl.formatMessage(
        { id: 'files.tray.uploadingAria', defaultMessage: 'Uploading {name}' },
        { name: name || 'file' }
      )}
    </span>
  )
}

function RetryButton({
  item,
  onRetry,
  className,
}: {
  item: ComposerAttachmentItem
  onRetry: (localId: string) => void
  className?: string
}) {
  const intl = useIntl()
  return (
    <button
      type="button"
      onClick={() => onRetry(item.localId)}
      aria-label={intl.formatMessage(
        { id: 'files.tray.retryAria', defaultMessage: 'Retry uploading {name}' },
        { name: item.name || 'file' }
      )}
      className={className}
    >
      {intl.formatMessage({ id: 'files.tray.retry', defaultMessage: 'Retry' })}
    </button>
  )
}

function ImageTile({ item, onRemove, onRetry, onOpen }: TileProps) {
  const intl = useIntl()
  const src = item.file?.url ?? item.previewUrl
  const failed = item.status === 'error'
  const ready = item.status === 'ready'
  const errorText = failed ? localizedError(item, intl) : undefined
  return (
    <div
      className={cn(
        'group relative size-16 shrink-0 overflow-hidden rounded-md border bg-muted/30',
        failed ? 'border-destructive/40' : 'border-border/60'
      )}
    >
      {src &&
        (ready && onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(item)}
            aria-label={intl.formatMessage(
              { id: 'files.card.open', defaultMessage: 'Open {name}' },
              { name: item.name || 'file' }
            )}
            className="block size-full"
          >
            <img src={src} alt="" className="size-full object-cover" />
          </button>
        ) : (
          <img src={src} alt={item.name || 'Image'} className="size-full object-cover" />
        ))}
      {item.status === 'uploading' && (
        <>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20" aria-hidden="true">
            <div
              data-progress={Math.round(item.progress * 100)}
              className="h-full bg-white/90 transition-[width]"
              style={{ width: `${Math.round(item.progress * 100)}%` }}
            />
          </div>
          <UploadingAnnouncement name={item.name} />
        </>
      )}
      {failed && (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-destructive/85 p-1 text-center text-[11px] font-medium leading-tight text-white"
        >
          <span className="line-clamp-2" title={errorText}>
            {errorText}
          </span>
          {item.retryable && (
            <RetryButton item={item} onRetry={onRetry} className="underline underline-offset-2" />
          )}
        </div>
      )}
      <RemoveButton item={item} onRemove={onRemove} />
    </div>
  )
}

function FileTile({ item, onRemove, onRetry, onOpen }: TileProps) {
  const intl = useIntl()
  const failed = item.status === 'error'
  const ready = item.status === 'ready'
  const errorText = failed ? localizedError(item, intl) : undefined
  const body = (
    <>
      <FileBadge name={item.name} family={item.family} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs font-medium text-foreground">{item.name || 'File'}</span>
        {ready && (
          <span className="text-[11px] text-muted-foreground">{formatBytes(item.size)}</span>
        )}
        {item.status === 'uploading' && (
          <>
            <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                data-progress={Math.round(item.progress * 100)}
                className="h-full rounded-full bg-foreground/60 transition-[width]"
                style={{ width: `${Math.round(item.progress * 100)}%` }}
              />
            </div>
            <UploadingAnnouncement name={item.name} />
          </>
        )}
        {failed && (
          <span
            role="alert"
            className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-destructive"
          >
            <span className="truncate">{errorText}</span>
            {item.retryable && (
              <RetryButton
                item={item}
                onRetry={onRetry}
                className="shrink-0 underline underline-offset-2 hover:no-underline"
              />
            )}
          </span>
        )}
      </div>
    </>
  )
  return (
    <div
      className={cn(
        'group relative flex h-14 w-52 shrink-0 items-center gap-2 rounded-md border px-2.5',
        failed ? 'border-destructive/40 bg-destructive/5' : 'border-border/60 bg-muted/30'
      )}
    >
      {ready && onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(item)}
          aria-label={intl.formatMessage(
            { id: 'files.card.open', defaultMessage: 'Open {name}' },
            { name: item.name || 'file' }
          )}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {body}
        </button>
      ) : (
        body
      )}
      <RemoveButton item={item} onRemove={onRemove} />
    </div>
  )
}

/**
 * The tray's one-line notice when `addFiles` refuses a file for being over
 * the attachment cap — text, not a file-shaped tile, since it names no file
 * of its own.
 */
function CapNoticeLine({ item, onRemove }: Omit<TileProps, 'onRetry'>) {
  const intl = useIntl()
  return (
    <div
      role="alert"
      className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] font-medium text-destructive"
    >
      <span>{localizedError(item, intl)}</span>
      <button
        type="button"
        onClick={() => onRemove(item.localId)}
        aria-label={intl.formatMessage({ id: 'files.tray.dismiss', defaultMessage: 'Dismiss' })}
        className="text-destructive/70 transition-colors hover:text-destructive"
      >
        <XMarkIcon className="h-3 w-3" />
      </button>
    </div>
  )
}

/**
 * Pending-attachment tray for the conversation composer: every added file
 * stages as its own tile with upload progress and, on failure, the error on
 * the tile itself — error tiles stay until removed, never block Send, and
 * are never sent. Image tiles are a plain thumbnail (local object URL while
 * uploading, the stored file's URL once ready); every other file is a badge +
 * name + one meta line. Rendered INSIDE the composer input, below the editor,
 * so it reads as part of the message being drafted. Clicking a ready tile
 * opens the shared viewer, with every other ready tile in the tray as its
 * gallery — the still-uploading/failed ones have nothing to show yet and are
 * left out.
 */
export function ComposerAttachmentTray({
  items,
  onRemove,
  onRetry,
}: {
  items: ComposerAttachmentItem[]
  onRemove: (localId: string) => void
  onRetry: (localId: string) => void
}) {
  const { open } = useFileViewer()
  if (items.length === 0) return null

  const readyItems = items.filter((it) => it.status === 'ready' && it.file)
  const readyFiles = readyItems.map((it) => toViewerFile(it.file!))
  const onOpen = (item: ComposerAttachmentItem) => {
    const index = readyItems.findIndex((it) => it.localId === item.localId)
    if (index >= 0) open(readyFiles, index)
  }

  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {items.map((item) =>
        item.errorReason === 'cap' ? (
          <CapNoticeLine key={item.localId} item={item} onRemove={onRemove} />
        ) : item.family === 'image' ? (
          <ImageTile
            key={item.localId}
            item={item}
            onRemove={onRemove}
            onRetry={onRetry}
            onOpen={onOpen}
          />
        ) : (
          <FileTile
            key={item.localId}
            item={item}
            onRemove={onRemove}
            onRetry={onRetry}
            onOpen={onOpen}
          />
        )
      )}
    </div>
  )
}
