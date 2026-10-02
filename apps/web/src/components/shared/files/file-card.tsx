/**
 * Attachment cards: the three densities a file renders at (UI brief "Cards"
 * mockup) — a 248px preview card once the server's preview job has something
 * to show, a plain icon card otherwise, and a compact row for narrow surfaces
 * (the widget) and list contexts (the conversation sidebar). All three are
 * buttons that open the shared file viewer; the download control is a
 * separate `<a>` so it keeps working without JS and stays keyboard-reachable
 * on its own tab stop — nesting it inside the opening button would be invalid
 * HTML and would fire both actions on one click.
 *
 * A card never waits on the preview job: it renders the icon card until a
 * thumbnail, a head grid or a text excerpt exists, then the caller
 * (`AttachmentList`) upgrades it to the preview card in place.
 */
import { useIntl, type IntlShape } from 'react-intl'
import { ArrowDownTrayIcon, PlayIcon } from '@heroicons/react/24/outline'
import { FileBadge } from './file-badge'
import { downloadUrl } from './download-url'
import { FAMILY_NAME, familyFor, formatBytes, type FileFamily } from '@/lib/shared/files/file-types'
import type { AttachmentPreview, ConversationAttachment } from '@/lib/shared/conversation/types'
import { cn } from '@/lib/shared/utils/cn'

/** `FAMILY_NAME`'s message id per family, for the card's localized fallback
 *  line. `csv` shares `spreadsheet`'s id: both read "Spreadsheet". */
const FAMILY_NAME_ID: Record<FileFamily, string> = {
  image: 'files.family.image',
  video: 'files.family.video',
  audio: 'files.family.audio',
  pdf: 'files.family.pdf',
  document: 'files.family.document',
  spreadsheet: 'files.family.spreadsheet',
  presentation: 'files.family.presentation',
  csv: 'files.family.spreadsheet',
  text: 'files.family.text',
  code: 'files.family.code',
  archive: 'files.family.archive',
  other: 'files.family.other',
}

/** The family driving a card's thumb/meta choice — stored on the attachment
 *  for files that went through the pipeline, derived from the name/type for
 *  older rows that predate it. */
export function resolveFamily(attachment: ConversationAttachment): FileFamily {
  return attachment.family ?? familyFor(attachment.name, attachment.contentType)
}

/** "2:14" from milliseconds, for a video's duration pill and meta line. */
function durationLabel(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * The specific count a family's meta line leads with (page/row/line/
 * duration/dimension counts), once the preview job has it — "2 pages", "1,248
 * rows" — or no parts at all for a family with no rich rule, or one that
 * hasn't got its preview data yet. Shared by the meta line (which falls back
 * to the family name when this is empty) and the card's aria-label (which
 * states the family either way, since nothing else speaks it to a screen
 * reader).
 */
function metaParts(
  family: FileFamily,
  preview: AttachmentPreview | undefined,
  intl: IntlShape
): string[] {
  const plural = (id: string, defaultMessage: string, count: number) =>
    intl.formatMessage({ id, defaultMessage }, { count })
  switch (family) {
    case 'pdf':
    case 'document':
      return preview?.pages != null
        ? [
            plural(
              'files.count.pages',
              '{count, plural, one {# page} other {# pages}}',
              preview.pages
            ),
          ]
        : []
    case 'spreadsheet':
    case 'csv': {
      // Rows alone keep the line to one clear count; a sheet count on top of
      // rows reads as two different numbers competing for attention, so rows
      // win whenever both are known. Only once rows aren't known yet does the
      // sheet count stand in as the next-most-useful thing to show.
      const sheetCount = preview?.sheets?.length ?? 0
      const rows = preview?.rows
      if (rows != null) {
        return [plural('files.count.rows', '{count, plural, one {# row} other {# rows}}', rows)]
      }
      if (sheetCount > 1) {
        return [
          plural(
            'files.count.sheets',
            '{count, plural, one {# sheet} other {# sheets}}',
            sheetCount
          ),
        ]
      }
      return []
    }
    case 'text':
    case 'code':
      return preview?.lines != null
        ? [
            plural(
              'files.count.lines',
              '{count, plural, one {# line} other {# lines}}',
              preview.lines
            ),
          ]
        : []
    case 'video':
      return preview?.durationMs != null ? [durationLabel(preview.durationMs)] : []
    case 'image':
      return preview?.width != null && preview?.height != null
        ? [`${preview.width} × ${preview.height}`]
        : []
    case 'archive':
      return preview?.entries != null
        ? [
            plural(
              'files.count.files',
              '{count, plural, one {# file} other {# files}}',
              preview.entries
            ),
          ]
        : []
    default:
      return []
  }
}

/**
 * The card's one quiet meta line. Each family shows what people actually
 * check a file for (page/row/line/duration/dimension counts) once the
 * preview job has them, and falls back to the family name plus size
 * otherwise — the same fallback a file with no preview data at all uses on
 * the icon card.
 */
export function attachmentMetaLine(
  name: string,
  family: FileFamily,
  size: number,
  preview: AttachmentPreview | undefined,
  intl: IntlShape
): string {
  const bytes = formatBytes(size)
  const parts = metaParts(family, preview, intl)
  if (parts.length > 0) return `${parts.join(' · ')} · ${bytes}`
  const familyLabel = intl.formatMessage({
    id: FAMILY_NAME_ID[family],
    defaultMessage: FAMILY_NAME[family],
  })
  return `${familyLabel} · ${bytes}`
}

/**
 * A card's accessible name: "Open {name}, {family}, {counts…}, {size}" —
 * everything the meta line and badge show a sighted person, spoken out since
 * neither renders as text a screen reader can read on its own. Unlike the
 * meta line (which only names the family as a fallback when there is no
 * richer count to show), this always states the family — the badge that
 * shows it visually carries no accessible text of its own.
 */
export function attachmentAriaLabel(
  name: string,
  family: FileFamily,
  size: number,
  preview: AttachmentPreview | undefined,
  intl: IntlShape
): string {
  const familyLabel = intl.formatMessage({
    id: FAMILY_NAME_ID[family],
    defaultMessage: FAMILY_NAME[family],
  })
  const detail = [familyLabel, ...metaParts(family, preview, intl), formatBytes(size)].join(', ')
  return intl.formatMessage(
    { id: 'files.card.openWithMeta', defaultMessage: 'Open {name}, {detail}' },
    { name: name || 'file', detail }
  )
}

/** Whether a file has preview data worth a thumb, over the plain icon card.
 *  Video is always "worth it": the browser can show the first frame as a
 *  poster with nothing from the preview job. */
export function hasPreviewWorthShowing(attachment: ConversationAttachment): boolean {
  if (resolveFamily(attachment) === 'video') return true
  const preview = attachment.preview
  if (!preview) return false
  return !!preview.thumbUrl || (!!preview.head && preview.head.length > 0) || !!preview.text
}

/** A small warning-coloured note, never replacing the meta line. */
function MacroWarning() {
  const intl = useIntl()
  return (
    <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
      {intl.formatMessage({ id: 'files.viewer.macros', defaultMessage: 'Contains macros' })}
    </span>
  )
}

function MetaLine({
  name,
  family,
  size,
  preview,
}: {
  name: string
  family: FileFamily
  size: number
  preview?: AttachmentPreview
}) {
  const intl = useIntl()
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-[11.5px] text-muted-foreground">
        {attachmentMetaLine(name, family, size, preview, intl)}
      </span>
      {preview?.macro && <MacroWarning />}
    </span>
  )
}

function DownloadLink({ url, name, className }: { url: string; name: string; className?: string }) {
  const intl = useIntl()
  const label = intl.formatMessage(
    { id: 'files.card.download', defaultMessage: 'Download {name}' },
    { name: name || 'file' }
  )
  return (
    <a
      href={downloadUrl(url, name || 'file')}
      download={name || undefined}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      title={intl.formatMessage({ id: 'files.viewer.download', defaultMessage: 'Download' })}
      className={cn(
        // Hidden until hover/focus on a pointer that supports hover; a touch
        // device has no hover to reveal it, so it stays visible there instead.
        'flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-opacity [@media(hover:hover)]:opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/card:opacity-100 group-focus-within/card:opacity-100',
        className
      )}
    >
      <ArrowDownTrayIcon className="size-4" />
    </a>
  )
}

function VideoThumb({ url, durationMs }: { url: string; durationMs?: number }) {
  return (
    <>
      {/* `#t=0.1` asks the browser to seek just past the first frame so a
          poster shows for formats whose frame 0 is often black. No controls,
          no autoplay — this is a static poster, the viewer plays the file. */}
      <video
        preload="metadata"
        muted
        playsInline
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
        src={`${url}#t=0.1`}
      />
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-black/55 text-white">
          <PlayIcon className="size-4 translate-x-px" />
        </span>
      </span>
      {durationMs != null && (
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
          {durationLabel(durationMs)}
        </span>
      )}
    </>
  )
}

/** A rendered page/image thumbnail — object-cover, top-aligned so a tall page
 *  crops from the bottom, on the thumb's muted ground. */
function ImageThumb({ url }: { url: string }) {
  return <img src={url} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
}

/** A spreadsheet/CSV's first rows, as a small text grid — never rendered as
 *  HTML the sheet itself supplied, only data this app already parsed. */
function HeadGrid({ head }: { head: string[][] }) {
  const rows = head.slice(0, 6)
  return (
    <div className="absolute inset-0 overflow-hidden bg-card p-1">
      <table className="w-full table-fixed border-collapse text-[11px] leading-tight">
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className={ri === 0 ? 'font-medium text-foreground' : 'text-foreground/70'}
            >
              {row.slice(0, 6).map((cell, ci) => (
                <td key={ci} className="truncate border border-border/40 px-1 py-0.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A text/log/code file's first lines, on a dark code surface like the
 *  viewer's own text engine uses. */
function TextThumb({ text }: { text: string }) {
  const lines = text.split('\n').slice(0, 8)
  return (
    <div className="absolute inset-0 overflow-hidden bg-zinc-900 px-2 py-1.5 font-mono text-[11px] leading-[1.4] text-zinc-300">
      {lines.map((line, i) => (
        <div key={i} className="truncate whitespace-pre">
          {line || ' '}
        </div>
      ))}
    </div>
  )
}

function AttachmentThumb({
  attachment,
  family,
}: {
  attachment: ConversationAttachment
  family: FileFamily
}) {
  const preview = attachment.preview
  if (family === 'video') {
    return <VideoThumb url={attachment.url} durationMs={preview?.durationMs} />
  }
  if (preview?.thumbUrl) {
    return <ImageThumb url={preview.thumbUrl} />
  }
  if (preview?.head && preview.head.length > 0) {
    return <HeadGrid head={preview.head} />
  }
  if (preview?.text) {
    return <TextThumb text={preview.text} />
  }
  return (
    <div className="flex h-full items-center justify-center">
      <FileBadge name={attachment.name} family={family} size="lg" />
    </div>
  )
}

export interface FileCardProps {
  attachment: ConversationAttachment
  onOpen: () => void
  className?: string
}

/**
 * ~248px card with a thumbnail. `wide` spans two grid columns at a 16:9 thumb
 * (the mockup's video-in-a-thread treatment); every other preview uses the
 * fixed 132px thumb height so a row of cards lines up regardless of format.
 */
export function FilePreviewCard({
  attachment,
  onOpen,
  wide = false,
  className,
}: FileCardProps & { wide?: boolean }) {
  const intl = useIntl()
  const family = resolveFamily(attachment)
  const name = attachment.name || 'File'
  return (
    <div
      className={cn(
        'group/card relative flex w-full max-w-[248px] flex-col overflow-hidden rounded-[10px] border border-border bg-card transition-colors hover:border-foreground/30',
        wide && 'max-w-[504px]',
        className
      )}
    >
      {/* One button covers the whole card (thumb + footer text) so there is
          exactly one "Open <name>" control; the download link is an absolutely
          positioned sibling over the footer, not nested inside the button
          (nesting an `<a>` inside a `<button>` is invalid and would fire both
          actions on one click). */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={attachmentAriaLabel(name, family, attachment.size, attachment.preview, intl)}
        className="flex w-full flex-col text-left"
      >
        <span
          className={cn(
            'relative block overflow-hidden border-b border-border/60 bg-muted',
            wide ? 'aspect-video' : 'h-[132px]'
          )}
        >
          <AttachmentThumb attachment={attachment} family={family} />
        </span>
        <span className="flex items-center gap-2.5 px-2.5 py-2 pr-9">
          <FileBadge name={attachment.name} family={family} size="sm" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium text-foreground">{name}</span>
            <MetaLine
              name={name}
              family={family}
              size={attachment.size}
              preview={attachment.preview}
            />
          </span>
        </span>
      </button>
      <DownloadLink
        url={attachment.url}
        name={name}
        className="absolute bottom-1.5 right-1.5 size-7"
      />
    </div>
  )
}

/** Same footprint without a thumb: a large badge, the name, and the meta
 *  line — the default card, and the fallback for any format with no preview
 *  data at all (or none the browser can derive, like a legacy .ppt). */
export function FileIconCard({ attachment, onOpen, className }: FileCardProps) {
  const intl = useIntl()
  const family = resolveFamily(attachment)
  const name = attachment.name || 'File'
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={attachmentAriaLabel(name, family, attachment.size, attachment.preview, intl)}
      className={cn(
        'flex w-full max-w-[248px] items-center gap-2.5 rounded-[10px] border border-border bg-card px-2.5 py-2.5 text-left transition-colors hover:border-foreground/30',
        className
      )}
    >
      <FileBadge name={attachment.name} family={family} size="lg" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-medium text-foreground">{name}</span>
        <MetaLine name={name} family={family} size={attachment.size} preview={attachment.preview} />
      </span>
    </button>
  )
}

/** A compact row: badge (or a tiny page thumb when one is on hand), name,
 *  meta, download. Used in the widget, narrow sidebars/columns and the
 *  conversation's file list. */
export function FileRow({ attachment, onOpen, className }: FileCardProps) {
  const intl = useIntl()
  const family = resolveFamily(attachment)
  const name = attachment.name || 'File'
  const thumbUrl = attachment.preview?.thumbUrl
  return (
    <div
      className={cn(
        'group/card flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5',
        className
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={attachmentAriaLabel(name, family, attachment.size, attachment.preview, intl)}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        {thumbUrl ? (
          <span className="relative h-11 w-[34px] shrink-0 overflow-hidden rounded-[3px] bg-muted outline outline-1 -outline-offset-1 outline-border">
            <ImageThumb url={thumbUrl} />
          </span>
        ) : (
          <FileBadge name={attachment.name} family={family} />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[12.5px] font-medium text-foreground">{name}</span>
          <MetaLine
            name={name}
            family={family}
            size={attachment.size}
            preview={attachment.preview}
          />
        </span>
      </button>
      <DownloadLink url={attachment.url} name={name} className="size-6" />
    </div>
  )
}
