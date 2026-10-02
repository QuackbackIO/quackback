/**
 * The file viewer's shell: one dialog (a full-height sheet in the widget) that
 * shows every format the same way. It owns the header, the gallery, the
 * keyboard, fetching the bytes, the loading state, every failure state and
 * the open count; the format engines own only the content area and report
 * their controls through `onToolbar` (see `types.ts`).
 *
 * Loaded on demand by `FileViewerProvider`, so no surface pays for it until
 * someone opens a file.
 */
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useIntl } from 'react-intl'
import {
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowTurnDownLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { buttonVariants } from '@/components/ui/button'
import { formatBytes, MAX_ATTACHMENT_BYTES } from '@/lib/shared/files/file-types'
import { cn } from '@/lib/shared/utils'
import { downloadUrl, withQueryParams } from './download-url'
import { FileBadge } from './file-badge'
import { ViewerSkeleton } from './viewer-skeleton'
import {
  VIEWER_ARROWS_ATTR,
  type EngineFailure,
  type EngineToolbar,
  type ViewerEngineProps,
  type ViewerFile,
} from './types'
import { ENGINES, engineFor, fetchModeFor, TEXT_HEAD_BYTES, type EngineKind } from './viewers'

export interface FileViewerProps {
  files: ViewerFile[]
  /** The file to show first. */
  index: number
  open: boolean
  /** The widget's full-height sheet: a back arrow and only the essential controls. */
  compact?: boolean
  /** Where focus returns when the viewer closes. */
  opener?: HTMLElement | null
  /** Makes the header's "sender · time · size" line jump to the file's message. */
  onJumpToMessage?: (messageId: string) => void
  /** The person asked to close (Esc, Close, Back, outside press, jump). */
  onClose: () => void
  /** The close transition finished; the viewer can unmount. */
  onClosed?: () => void
  /** Engine components by kind; defaults to the lazy registry. */
  engines?: Partial<Record<EngineKind, ComponentType<ViewerEngineProps>>>
}

/** Bytes a whole-file fetch may bring: the upload cap. */
const FULL_FETCH_BUDGET = MAX_ATTACHMENT_BYTES

const ZOOM_STEP = 0.25

const FAILURE_MESSAGE: Record<EngineFailure, { id: string; defaultMessage: string }> = {
  unsupported: {
    id: 'files.viewer.failureUnsupported',
    defaultMessage: 'No preview for this file type',
  },
  corrupt: { id: 'files.viewer.failureCorrupt', defaultMessage: "This file can't be previewed" },
  too_large: { id: 'files.viewer.failureTooLarge', defaultMessage: 'Too large to preview' },
  unavailable: {
    id: 'files.viewer.failureUnavailable',
    defaultMessage: 'This file is no longer available',
  },
  empty: { id: 'files.viewer.failureEmpty', defaultMessage: 'This file is empty' },
}

/** The same-origin URL for a stored file's bytes (`?proxy=1` streams through this origin). */
export function proxyUrl(url: string): string {
  return withQueryParams(url, { proxy: '1' })
}

class FetchFailure extends Error {
  constructor(readonly failure: EngineFailure) {
    super(failure)
  }
}

function failureForStatus(status: number): EngineFailure {
  if (status === 404 || status === 410 || status === 403) return 'unavailable'
  if (status === 413) return 'too_large'
  return 'corrupt'
}

/** Reads a body up to `cap` bytes, and says whether more was there. */
async function readUpTo(res: Response, cap: number): Promise<{ bytes: Uint8Array; more: boolean }> {
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer())
    return { bytes: all.subarray(0, cap), more: all.byteLength > cap }
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let more = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
    if (total > cap) {
      more = true
      await reader.cancel().catch(() => {})
      break
    }
  }
  const bytes = new Uint8Array(Math.min(total, cap))
  let at = 0
  for (const chunk of chunks) {
    const room = bytes.byteLength - at
    if (room <= 0) break
    bytes.set(chunk.byteLength > room ? chunk.subarray(0, room) : chunk, at)
    at += Math.min(chunk.byteLength, room)
  }
  return { bytes, more }
}

/** Total size from `Content-Range: bytes 0-262143/600000`, when the server says. */
function rangeTotal(res: Response): number | null {
  const match = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')
  return match ? Number(match[1]) : null
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function fetchFileBytes(
  file: ViewerFile,
  mode: 'head' | 'full',
  signal: AbortSignal
): Promise<{ data: ArrayBuffer; truncated: boolean }> {
  const res = await fetch(proxyUrl(file.url), {
    signal,
    credentials: 'same-origin',
    ...(mode === 'head' ? { headers: { Range: `bytes=0-${TEXT_HEAD_BYTES - 1}` } } : {}),
  })
  // An empty file has no first byte to range over.
  if (mode === 'head' && res.status === 416) return { data: new ArrayBuffer(0), truncated: false }
  if (!res.ok) throw new FetchFailure(failureForStatus(res.status))

  if (mode === 'full') {
    const declared = Number(res.headers.get('content-length'))
    if (declared > FULL_FETCH_BUDGET) {
      await res.body?.cancel().catch(() => {})
      throw new FetchFailure('too_large')
    }
    const { bytes, more } = await readUpTo(res, FULL_FETCH_BUDGET)
    if (more) throw new FetchFailure('too_large')
    return { data: exactBuffer(bytes), truncated: false }
  }

  const { bytes, more } = await readUpTo(res, TEXT_HEAD_BYTES)
  const total = rangeTotal(res)
  return {
    data: exactBuffer(bytes),
    truncated: more || (total !== null && total > bytes.byteLength),
  }
}

function sendOpenBeacon(fileId: string) {
  const url = `/api/files/opened?fileId=${encodeURIComponent(fileId)}`
  try {
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url)) return
  } catch {
    // Fall through to fetch.
  }
  fetch(url, { method: 'POST', keepalive: true }).catch(() => {})
}

function formatSentAt(iso: string | undefined): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const now = new Date()
  const sameDay = at.toDateString() === now.toDateString()
  return new Intl.DateTimeFormat(undefined, {
    ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  }).format(at)
}

function isTextEntry(el: HTMLElement): boolean {
  if (el.isContentEditable) return true
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'reset', 'submit', 'file', 'color'].includes(
      el.type
    )
  }
  return false
}

/** The next zoom on the shared 25% grid, within the engine's range. */
function zoomStep(zoom: NonNullable<EngineToolbar['zoom']>, direction: 1 | -1): number {
  const steps = zoom.value / ZOOM_STEP
  const next =
    direction > 0
      ? (Math.floor(steps + 1e-6) + 1) * ZOOM_STEP
      : (Math.ceil(steps - 1e-6) - 1) * ZOOM_STEP
  return Math.min(zoom.max, Math.max(zoom.min, Number(next.toFixed(4))))
}

type Shown =
  | { status: 'loading' }
  | { status: 'ready'; data: ArrayBuffer | null; truncated: boolean }
  | { status: 'failed'; failure: EngineFailure }

type Fetched = { key: string } & (
  | { status: 'ready'; data: ArrayBuffer; truncated: boolean }
  | { status: 'failed'; failure: EngineFailure }
)

export default function FileViewer({
  files,
  index,
  open,
  compact = false,
  opener,
  onJumpToMessage,
  onClose,
  onClosed,
  engines = ENGINES,
}: FileViewerProps) {
  const intl = useIntl()
  const [current, setCurrent] = useState(() =>
    Math.min(Math.max(0, index), Math.max(0, files.length - 1))
  )
  const file = files[current]!
  const kind = engineFor(file)
  const mode = kind ? fetchModeFor(kind) : 'none'

  // Engine reports are keyed by file, so a late report from the file just
  // left never lands on the one now showing.
  const [toolbars, setToolbars] = useState<Record<string, EngineToolbar>>({})
  const [engineFailures, setEngineFailures] = useState<Record<string, EngineFailure>>({})
  const [fetched, setFetched] = useState<Fetched | null>(null)

  const go = useCallback(
    (delta: number) => {
      if (files.length < 2) return
      setToolbars({})
      setEngineFailures({})
      setCurrent((i) => (i + delta + files.length) % files.length)
    },
    [files.length]
  )

  const needsFetch =
    kind !== null && mode !== 'none' && !(mode === 'full' && file.size > FULL_FETCH_BUDGET)
  // Coming back to the file already in hand keeps its bytes.
  const haveBytes = fetched?.key === file.key
  useEffect(() => {
    if (!open || !needsFetch || haveBytes) return
    const controller = new AbortController()
    const key = file.key
    fetchFileBytes(file, mode, controller.signal).then(
      ({ data, truncated }) => {
        if (!controller.signal.aborted) setFetched({ key, status: 'ready', data, truncated })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const failure = error instanceof FetchFailure ? error.failure : 'corrupt'
        setFetched({ key, status: 'failed', failure })
      }
    )
    return () => controller.abort()
  }, [open, needsFetch, haveBytes, mode, file])

  const counted = useRef(new Set<string>())
  useEffect(() => {
    if (!open || !file.fileId || counted.current.has(file.fileId)) return
    counted.current.add(file.fileId)
    sendOpenBeacon(file.fileId)
  }, [open, file.fileId])

  const shown: Shown = (() => {
    const engineFailure = engineFailures[file.key]
    if (engineFailure) return { status: 'failed', failure: engineFailure }
    if (kind === null) return { status: 'failed', failure: 'unsupported' }
    if (mode === 'none') return { status: 'ready', data: null, truncated: false }
    if (mode === 'full' && file.size > FULL_FETCH_BUDGET) {
      return { status: 'failed', failure: 'too_large' }
    }
    if (fetched?.key !== file.key) return { status: 'loading' }
    return fetched
  })()

  const engineCallbacks = useMemo(() => {
    const key = file.key
    return {
      onToolbar: (toolbar: EngineToolbar) => setToolbars((all) => ({ ...all, [key]: toolbar })),
      onError: (failure: EngineFailure) =>
        setEngineFailures((all) => (all[key] ? all : { ...all, [key]: failure })),
    }
  }, [file.key])

  const toolbar: EngineToolbar = (shown.status === 'ready' && toolbars[file.key]) || {}

  const popupRef = useRef<HTMLDivElement>(null)

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented) return
    const target = e.target as HTMLElement
    const mod = e.metaKey || e.ctrlKey
    if (mod && !e.altKey && e.key.toLowerCase() === 'f') {
      if (toolbar.find) {
        e.preventDefault()
        toolbar.find.open()
      }
      return
    }
    if (mod || e.altKey || isTextEntry(target)) return
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        if (files.length < 2 || target.closest(`[${VIEWER_ARROWS_ATTR}]`)) return
        e.preventDefault()
        go(e.key === 'ArrowRight' ? 1 : -1)
        return
      case '+':
      case '=':
      case '-':
      case '_':
      case '0': {
        const zoom = toolbar.zoom
        if (!zoom) return
        e.preventDefault()
        if (e.key === '0') zoom.set(Math.min(zoom.max, Math.max(zoom.min, 1)))
        else zoom.set(zoomStep(zoom, e.key === '+' || e.key === '=' ? 1 : -1))
        return
      }
    }
  }

  const jumpable = !compact && Boolean(onJumpToMessage && file.messageId)
  const subLine = [file.senderName, formatSentAt(file.sentAt), formatBytes(file.size)]
    .filter(Boolean)
    .join(' · ')

  const Engine = kind ? engines[kind] : undefined
  const downloadLabel = intl.formatMessage({
    id: 'files.viewer.download',
    defaultMessage: 'Download',
  })
  const download = (
    <a
      href={downloadUrl(file.url, file.name)}
      aria-label={downloadLabel}
      title={downloadLabel}
      className={TOOL_BUTTON}
    >
      <ArrowDownTrayIcon className="size-[17px]" />
    </a>
  )
  const gallery = files.length > 1 && (
    <>
      <ToolButton
        label={intl.formatMessage({
          id: 'files.viewer.previousFile',
          defaultMessage: 'Previous file',
        })}
        onClick={() => go(-1)}
      >
        <ChevronLeftIcon className="size-[17px]" />
      </ToolButton>
      <span
        className={cn(
          'px-1.5 text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums',
          compact && 'sr-only'
        )}
      >
        {intl.formatMessage(
          { id: 'files.viewer.counter', defaultMessage: '{current} of {total}' },
          { current: current + 1, total: files.length }
        )}
      </span>
      <ToolButton
        label={intl.formatMessage({
          id: 'files.viewer.nextFile',
          defaultMessage: 'Next file',
        })}
        onClick={() => go(1)}
      >
        <ChevronRightIcon className="size-[17px]" />
      </ToolButton>
    </>
  )
  const hasEngineTools = Boolean(
    toolbar.note || toolbar.page || toolbar.zoom || toolbar.find || toolbar.wrap
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (next) return
        // An engine that used Escape (closing its find bar) keeps the viewer open.
        if (details.reason === 'escape-key' && details.event.defaultPrevented) {
          details.cancel()
          return
        }
        onClose()
      }}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onClosed?.()
      }}
    >
      <DialogContent
        ref={popupRef}
        showCloseButton={false}
        instant={compact}
        initialFocus={popupRef}
        finalFocus={() => (opener && opener.isConnected ? opener : true)}
        onKeyDown={onKeyDown}
        className={cn(
          'flex flex-col gap-0 overflow-hidden bg-background p-0 text-foreground',
          compact
            ? 'top-0 left-0 h-full w-full max-w-none translate-x-0 translate-y-0 border-0 shadow-none [border-radius:0]'
            : 'h-[min(88vh,860px)] w-[92vw] max-w-[1240px] [border-radius:12px] max-sm:h-dvh max-sm:w-full max-sm:max-w-none max-sm:border-0 max-sm:[border-radius:0]'
        )}
      >
        <header
          className={cn(
            'flex shrink-0 items-center gap-2.5 border-b border-border bg-background',
            compact ? 'min-h-[52px] px-2 py-2' : 'min-h-[58px] px-3 py-2.5'
          )}
        >
          {compact ? (
            <ToolButton
              label={intl.formatMessage({ id: 'files.viewer.back', defaultMessage: 'Back' })}
              onClick={onClose}
            >
              <ArrowLeftIcon className="size-[17px]" />
            </ToolButton>
          ) : (
            <FileBadge name={file.name} family={file.family} />
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <DialogTitle className="truncate text-sm leading-snug font-semibold">
              {file.name}
            </DialogTitle>
            {subLine &&
              (jumpable ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    onJumpToMessage?.(file.messageId!)
                  }}
                  className="truncate text-left text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {subLine}
                </button>
              ) : (
                <span className="truncate text-xs text-muted-foreground">{subLine}</span>
              ))}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {compact ? (
              <>
                {toolbar.wrap && <WrapButton wrap={toolbar.wrap} />}
                {gallery}
                {download}
              </>
            ) : (
              <>
                {toolbar.note && (
                  <span className="px-1.5 text-[12.5px] whitespace-nowrap text-muted-foreground max-md:hidden">
                    {toolbar.note}
                  </span>
                )}
                {toolbar.page && (
                  <span className="px-1.5 text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums max-sm:hidden">
                    {intl.formatMessage(
                      { id: 'files.viewer.page', defaultMessage: 'Page {current} of {total}' },
                      { current: toolbar.page.current, total: toolbar.page.total }
                    )}
                  </span>
                )}
                {toolbar.zoom && <ZoomGroup zoom={toolbar.zoom} />}
                {toolbar.wrap && <WrapButton wrap={toolbar.wrap} />}
                {toolbar.find && (
                  <ToolButton
                    label={intl.formatMessage({ id: 'files.find.label', defaultMessage: 'Find' })}
                    onClick={toolbar.find.open}
                  >
                    <MagnifyingGlassIcon className="size-[17px]" />
                  </ToolButton>
                )}
                {hasEngineTools && <Separator />}
                {gallery}
                {download}
                <ToolButton
                  label={intl.formatMessage({ id: 'files.viewer.close', defaultMessage: 'Close' })}
                  onClick={onClose}
                >
                  <XMarkIcon className="size-[17px]" />
                </ToolButton>
              </>
            )}
          </div>
        </header>
        {compact && toolbar.note && (
          <p className="shrink-0 truncate border-b border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
            {toolbar.note}
          </p>
        )}

        <div className="relative flex min-h-0 flex-1 bg-[oklch(0.935_0_0)] dark:bg-[oklch(0.11_0_0)]">
          {shown.status === 'loading' ? (
            <ViewerSkeleton />
          ) : shown.status === 'failed' ? (
            <ViewerFallback file={file} failure={shown.failure} />
          ) : Engine ? (
            <EngineBoundary key={file.key} onError={engineCallbacks.onError}>
              <Suspense fallback={<ViewerSkeleton />}>
                <Engine
                  key={file.key}
                  file={file}
                  data={shown.data}
                  truncated={shown.truncated}
                  src={proxyUrl(file.url)}
                  onToolbar={engineCallbacks.onToolbar}
                  onError={engineCallbacks.onError}
                  compact={compact}
                />
              </Suspense>
            </EngineBoundary>
          ) : (
            <ViewerFallback file={file} failure="unsupported" />
          )}
        </div>

        {compact && toolbar.page && (
          <div className="flex shrink-0 items-center justify-center gap-2.5 border-t border-border bg-background p-2 text-[12.5px] text-muted-foreground tabular-nums">
            <ToolButton
              label={intl.formatMessage({
                id: 'files.viewer.previousPage',
                defaultMessage: 'Previous page',
              })}
              disabled={toolbar.page.current <= 1}
              onClick={() => toolbar.page?.go(toolbar.page.current - 1)}
            >
              <ChevronLeftIcon className="size-[17px]" />
            </ToolButton>
            {intl.formatMessage(
              { id: 'files.viewer.page', defaultMessage: 'Page {current} of {total}' },
              { current: toolbar.page.current, total: toolbar.page.total }
            )}
            <ToolButton
              label={intl.formatMessage({
                id: 'files.viewer.nextPage',
                defaultMessage: 'Next page',
              })}
              disabled={toolbar.page.current >= toolbar.page.total}
              onClick={() => toolbar.page?.go(toolbar.page.current + 1)}
            >
              <ChevronRightIcon className="size-[17px]" />
            </ToolButton>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

const TOOL_BUTTON =
  'inline-grid h-[30px] min-w-[30px] place-items-center rounded-[7px] px-[7px] text-[12.5px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-muted aria-pressed:text-foreground'

function ToolButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={TOOL_BUTTON}
    >
      {children}
    </button>
  )
}

function Separator() {
  return <span aria-hidden="true" className="mx-1.5 h-[18px] w-px bg-border max-sm:hidden" />
}

function ZoomGroup({ zoom }: { zoom: NonNullable<EngineToolbar['zoom']> }) {
  const intl = useIntl()
  return (
    <div
      role="group"
      aria-label={intl.formatMessage({ id: 'files.viewer.zoomGroupAria', defaultMessage: 'Zoom' })}
      className="flex items-center max-sm:hidden"
    >
      <ToolButton
        label={intl.formatMessage({ id: 'files.viewer.zoomOut', defaultMessage: 'Zoom out' })}
        disabled={zoom.value <= zoom.min + 1e-6}
        onClick={() => zoom.set(zoomStep(zoom, -1))}
      >
        <MinusIcon className="size-[17px]" />
      </ToolButton>
      <span className="w-11 text-center text-[12.5px] text-muted-foreground tabular-nums">
        {Math.round(zoom.value * 100)}%
      </span>
      <ToolButton
        label={intl.formatMessage({ id: 'files.viewer.zoomIn', defaultMessage: 'Zoom in' })}
        disabled={zoom.value >= zoom.max - 1e-6}
        onClick={() => zoom.set(zoomStep(zoom, 1))}
      >
        <PlusIcon className="size-[17px]" />
      </ToolButton>
    </div>
  )
}

function WrapButton({ wrap }: { wrap: NonNullable<EngineToolbar['wrap']> }) {
  const intl = useIntl()
  return (
    <ToolButton
      label={intl.formatMessage({ id: 'files.viewer.wrapLines', defaultMessage: 'Wrap lines' })}
      pressed={wrap.on}
      onClick={wrap.toggle}
    >
      <ArrowTurnDownLeftIcon className="size-[17px]" />
    </ToolButton>
  )
}

/**
 * The one failure state, for every format and every cause: the badge, what
 * happened in one sentence, and Download (unless the file is gone).
 */
export function ViewerFallback({ file, failure }: { file: ViewerFile; failure: EngineFailure }) {
  const intl = useIntl()
  const message = FAILURE_MESSAGE[failure]
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <FileBadge
        name={file.name}
        family={file.family}
        size="lg"
        className="size-14 rounded-xl text-[13px]"
      />
      <p className="text-sm font-medium text-foreground">{intl.formatMessage(message)}</p>
      {failure !== 'unavailable' && (
        <a
          href={downloadUrl(file.url, file.name)}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <ArrowDownTrayIcon />
          {intl.formatMessage({ id: 'files.viewer.download', defaultMessage: 'Download' })}
        </a>
      )}
    </div>
  )
}

/** A crashed engine, or an engine chunk that failed to load, falls back like any failure. */
class EngineBoundary extends Component<
  { onError: (failure: EngineFailure) => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onError('corrupt')
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
