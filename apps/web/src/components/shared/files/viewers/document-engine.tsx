/**
 * Word documents (.docx, .docm). The package's index is checked against the
 * zip budget, docx-preview renders it away from the page, and the sanitized
 * result is shown in a sandboxed frame as white pages on the desk. The frame
 * runs no script, so zoom re-renders its document at the new scale; its web
 * and mail links open in a new tab, as a PDF's do, and a click inside it
 * hands the keyboard straight back to the viewer.
 */
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useIntl, type IntlShape } from 'react-intl'
import type { EngineToolbar, ViewerEngineProps, ViewerFile } from '../types'
import { ViewerSkeleton } from '../viewer-skeleton'
import { BudgetTimeoutError, checkZipBudget, withTimeout } from './budgets'
import {
  DOCUMENT_SANDBOX,
  buildDocumentSrcdoc,
  renderDocumentHtml,
  type RenderedDocument,
} from './document-render'
import { macroNote } from './macros'
import { ZOOM_MAX, ZOOM_MIN, clampZoom } from './zoom'

/** The desk's padding around the pages inside the frame, plus room for its scrollbar. */
const DESK_GUTTER_PX = 48

/** The zoom that fits a page into the desk, never enlarging past 100%. */
export function documentFitZoom(deskWidth: number, pageWidthPx: number): number {
  const available = deskWidth - DESK_GUTTER_PX
  if (available <= 0 || pageWidthPx <= 0) return 1
  return Math.min(1, available / pageWidthPx)
}

/** "4 pages", "Contains macros", or both. */
export function documentNote(
  file: Pick<ViewerFile, 'name' | 'contentType' | 'preview'>,
  intl: IntlShape
): string | undefined {
  const parts: string[] = []
  const pages = file.preview?.pages
  if (pages) {
    parts.push(
      intl.formatMessage(
        {
          id: 'files.count.pages',
          defaultMessage: '{count, plural, one {# page} other {# pages}}',
        },
        { count: pages }
      )
    )
  }
  const macros = macroNote(file, intl)
  if (macros) parts.push(macros)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

/** Whether the app is in its dark theme (the `dark` class on the root). */
function useDarkTheme(): boolean {
  return useSyncExternalStore(
    subscribeToTheme,
    () => document.documentElement.classList.contains('dark'),
    () => false
  )
}

export default function DocumentEngine({ file, data, onToolbar, onError }: ViewerEngineProps) {
  const intl = useIntl()
  const deskRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [rendered, setRendered] = useState<RenderedDocument | null>(null)
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(1)
  const dark = useDarkTheme()
  const fail = useEffectEvent(onError)
  const report = useEffectEvent(onToolbar)

  useEffect(() => {
    setRendered(null)
    if (!data) return
    const budget = checkZipBudget(new Uint8Array(data))
    if (!budget.ok) {
      fail(budget.failure)
      return
    }
    let cancelled = false
    withTimeout(renderDocumentHtml(data)).then(
      (doc) => {
        if (cancelled) return
        if (doc.empty) {
          fail('empty')
          return
        }
        const fitted = documentFitZoom(deskRef.current?.clientWidth ?? 0, doc.pageWidthPx)
        setFit(fitted)
        setZoom(fitted)
        setRendered(doc)
      },
      (error: unknown) => {
        if (!cancelled) fail(error instanceof BudgetTimeoutError ? 'too_large' : 'corrupt')
      }
    )
    return () => {
      cancelled = true
    }
  }, [data])

  // A click inside the frame focuses it, and its document runs no script to
  // hand keys back, so Escape, the arrows, zoom and find would stop reaching
  // the viewer. Focus moves into a frame by blurring this window; once it has
  // landed on the frame, take it back to the desk.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onBlur = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const frame = frameRef.current
        if (frame && document.activeElement === frame)
          deskRef.current?.focus({ preventScroll: true })
      }, 0)
    }
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      clearTimeout(timer)
    }
  }, [])

  const changeZoom = useCallback((value: number) => setZoom(clampZoom(value, fit)), [fit])
  const note = documentNote(file, intl)

  useEffect(() => {
    if (!rendered) return
    const toolbar: EngineToolbar = {
      zoom: { value: zoom, min: Math.min(ZOOM_MIN, fit), max: ZOOM_MAX, set: changeZoom },
    }
    if (note) toolbar.note = note
    report(toolbar)
  }, [rendered, zoom, fit, changeZoom, note])

  const srcdoc = useMemo(
    () => (rendered ? buildDocumentSrcdoc(rendered.html, { zoom, dark }) : null),
    [rendered, zoom, dark]
  )

  return (
    <div
      ref={deskRef}
      tabIndex={-1}
      className="flex min-h-0 min-w-0 flex-1 bg-[oklch(0.935_0_0)] outline-none dark:bg-[oklch(0.11_0_0)]"
    >
      {srcdoc ? (
        <iframe
          ref={frameRef}
          title={file.name}
          sandbox={DOCUMENT_SANDBOX}
          srcDoc={srcdoc}
          referrerPolicy="no-referrer"
          className="block min-h-0 flex-1 border-0"
        />
      ) : (
        <ViewerSkeleton />
      )}
    </div>
  )
}
