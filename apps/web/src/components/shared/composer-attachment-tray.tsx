import { useIntl, type IntlShape } from 'react-intl'
import { XMarkIcon } from '@heroicons/react/24/solid'
import { FileBadge } from '@/components/shared/files/file-badge'
import { formatBytes, maxBytesForFamily } from '@/lib/shared/files/file-types'
import { cn } from '@/lib/shared/utils/cn'
import type { ComposerAttachmentItem } from '@/lib/client/hooks/use-conversation-composer-attachments'

interface TileProps {
  item: ComposerAttachmentItem
  onRemove: (localId: string) => void
  onRetry: (localId: string) => void
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

function ImageTile({ item, onRemove, onRetry }: TileProps) {
  const intl = useIntl()
  const src = item.file?.url ?? item.previewUrl
  const failed = item.status === 'error'
  const errorText = failed ? localizedError(item, intl) : undefined
  return (
    <div
      className={cn(
        'group relative size-16 shrink-0 overflow-hidden rounded-md border bg-muted/30',
        failed ? 'border-destructive/40' : 'border-border/60'
      )}
    >
      {src && <img src={src} alt={item.name || 'Image'} className="size-full object-cover" />}
      {item.status === 'uploading' && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
          <div
            data-progress={Math.round(item.progress * 100)}
            className="h-full bg-white/90 transition-[width]"
            style={{ width: `${Math.round(item.progress * 100)}%` }}
          />
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-destructive/85 p-1 text-center text-[11px] font-medium leading-tight text-white">
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

function FileTile({ item, onRemove, onRetry }: TileProps) {
  const intl = useIntl()
  const failed = item.status === 'error'
  const errorText = failed ? localizedError(item, intl) : undefined
  return (
    <div
      className={cn(
        'group relative flex h-14 w-52 shrink-0 items-center gap-2 rounded-md border px-2.5',
        failed ? 'border-destructive/40 bg-destructive/5' : 'border-border/60 bg-muted/30'
      )}
    >
      <FileBadge name={item.name} family={item.family} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs font-medium text-foreground">{item.name || 'File'}</span>
        {item.status === 'ready' && (
          <span className="text-[11px] text-muted-foreground">{formatBytes(item.size)}</span>
        )}
        {item.status === 'uploading' && (
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              data-progress={Math.round(item.progress * 100)}
              className="h-full rounded-full bg-foreground/60 transition-[width]"
              style={{ width: `${Math.round(item.progress * 100)}%` }}
            />
          </div>
        )}
        {failed && (
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-destructive">
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
      <RemoveButton item={item} onRemove={onRemove} />
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
 * so it reads as part of the message being drafted.
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
  if (items.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {items.map((item) =>
        item.family === 'image' ? (
          <ImageTile key={item.localId} item={item} onRemove={onRemove} onRetry={onRetry} />
        ) : (
          <FileTile key={item.localId} item={item} onRemove={onRemove} onRetry={onRetry} />
        )
      )}
    </div>
  )
}
