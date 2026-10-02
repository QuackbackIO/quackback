/**
 * One PDF page on the desk, and its thumbnail in the rail. A page draws its
 * canvas (at the screen's pixel ratio), its text layer (text nodes only, for
 * selection and find) and its web links only while it is near the viewport;
 * away from it the page keeps its size and drops its pixels.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { AnnotationMode, TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import type { TextContent } from 'pdfjs-dist/types/src/display/api'
import { cn } from '@/lib/shared/utils'
import {
  PDF_TO_CSS,
  canvasScale,
  highlightRanges,
  linkBoxes,
  type HighlightRange,
  type LinkBox,
  type PageTextIndex,
  type TextMatch,
} from './pdf-layout'

export interface PageText {
  content: TextContent
  index: PageTextIndex
}

export type PageTextLoader = (pageNumber: number) => Promise<PageText>

/** A canvas holding one page drawn at `cssScale` CSS pixels per PDF point. */
async function drawPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  cssScale: number,
  track: (task: RenderTask) => void
) {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: cssScale })
  const ratio = canvasScale(viewport.width, viewport.height, window.devicePixelRatio)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(viewport.width * ratio))
  canvas.height = Math.max(1, Math.floor(viewport.height * ratio))
  canvas.className = 'absolute inset-0 size-full'
  const task = page.render({
    canvas,
    viewport,
    transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    // Annotation appearances are drawn as pixels; nothing is interactive.
    annotationMode: AnnotationMode.ENABLE,
  })
  track(task)
  await task.promise
  return { page, viewport, canvas }
}

export function PdfPage({
  pdf,
  pageNumber,
  width,
  height,
  zoom,
  drawn,
  loadText,
  matches,
  activeMatch,
  revealNonce,
  register,
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  /** CSS pixels at the current zoom. */
  width: number
  height: number
  zoom: number
  drawn: boolean
  loadText: PageTextLoader
  /** This page's find matches, in page order. */
  matches: readonly TextMatch[]
  /** Index into `matches` of the current match, or -1. */
  activeMatch: number
  /** Changes each time the viewer moves to a match, to scroll it into view. */
  revealNonce: number
  register: (pageNumber: number, el: HTMLElement | null) => void
}) {
  const intl = useIntl()
  const canvasHost = useRef<HTMLDivElement>(null)
  const textHost = useRef<HTMLDivElement>(null)
  const textRuns = useRef<{ divs: HTMLElement[]; runs: string[]; index: PageTextIndex } | null>(
    null
  )
  const revealed = useRef(revealNonce)
  const [textVersion, setTextVersion] = useState(0)
  const [links, setLinks] = useState<LinkBox[]>([])

  const ref = useCallback(
    (el: HTMLElement | null) => register(pageNumber, el),
    [register, pageNumber]
  )

  useEffect(() => {
    if (!drawn) {
      canvasHost.current?.replaceChildren()
      textHost.current?.replaceChildren()
      textRuns.current = null
      return
    }
    let cancelled = false
    let renderTask: RenderTask | null = null
    let textLayer: TextLayer | null = null

    async function draw() {
      const { page, viewport, canvas } = await drawPage(pdf, pageNumber, zoom * PDF_TO_CSS, (t) => {
        renderTask = t
      })
      if (cancelled) return
      canvasHost.current?.replaceChildren(canvas)

      const text = await loadText(pageNumber)
      const host = textHost.current
      if (cancelled || !host) return
      host.replaceChildren()
      host.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit))
      textLayer = new TextLayer({ textContentSource: text.content, container: host, viewport })
      await textLayer.render()
      if (cancelled) return
      textRuns.current = {
        divs: textLayer.textDivs,
        runs: textLayer.textContentItemsStr,
        index: text.index,
      }
      setTextVersion((v) => v + 1)

      const annotations = await page.getAnnotations({ intent: 'display' })
      if (cancelled) return
      const atFullSize = page.getViewport({ scale: PDF_TO_CSS })
      setLinks(linkBoxes(annotations, (x, y) => atFullSize.convertToViewportPoint(x, y)))
    }

    // A page that fails to draw stays blank; the rest of the document still shows.
    draw().catch(() => {})
    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
    }
  }, [pdf, pageNumber, zoom, drawn, loadText])

  useEffect(() => {
    const state = textRuns.current
    if (!state) return
    for (const [i, div] of state.divs.entries()) {
      if (div.dataset.hit) {
        div.textContent = state.runs[i] ?? ''
        delete div.dataset.hit
      }
    }
    const byRun = new Map<number, HighlightRange[]>()
    for (const range of highlightRanges(state.index, matches, activeMatch)) {
      const list = byRun.get(range.item)
      if (list) list.push(range)
      else byRun.set(range.item, [range])
    }
    let activeEl: HTMLElement | null = null
    for (const [item, runRanges] of byRun) {
      const div = state.divs[item]
      const text = state.runs[item]
      if (!div || text === undefined) continue
      const nodes: Node[] = []
      let at = 0
      for (const range of runRanges) {
        if (range.start > at) nodes.push(document.createTextNode(text.slice(at, range.start)))
        const hit = document.createElement('span')
        hit.className = 'qb-pdf-hit'
        hit.textContent = text.slice(range.start, range.end)
        if (range.active) {
          hit.dataset.active = 'true'
          activeEl ??= hit
        }
        nodes.push(hit)
        at = range.end
      }
      if (at < text.length) nodes.push(document.createTextNode(text.slice(at)))
      div.replaceChildren(...nodes)
      div.dataset.hit = 'true'
    }
    if (activeEl && revealed.current !== revealNonce) {
      revealed.current = revealNonce
      activeEl.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
  }, [textVersion, matches, activeMatch, revealNonce])

  return (
    <div
      ref={ref}
      data-page={pageNumber}
      role="group"
      aria-label={intl.formatMessage(
        { id: 'files.pdf.pageAria', defaultMessage: 'Page {number}' },
        { number: pageNumber }
      )}
      className="relative shrink-0 bg-white shadow-[0_2px_14px_rgb(0_0_0/0.14)]"
      style={{ width, height }}
    >
      <div ref={canvasHost} className="absolute inset-0" />
      <div
        ref={textHost}
        className="qb-pdf-text"
        style={{ ['--scale-round-x' as string]: '1px', ['--scale-round-y' as string]: '1px' }}
      />
      {links.map((link, i) => (
        <a
          key={i}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          title={link.href}
          aria-label={link.href}
          className="absolute z-[2]"
          style={{
            left: link.left * zoom,
            top: link.top * zoom,
            width: link.width * zoom,
            height: link.height * zoom,
          }}
        />
      ))}
    </div>
  )
}

const THUMB_WIDTH = 80
/** The page number under a thumbnail: its line and the gap above it. */
const THUMB_LABEL_PX = 16 + 6

/** The height a thumbnail and its page number take in the rail. */
export function thumbSlotHeight(aspect: number): number {
  return Math.round(THUMB_WIDTH * aspect) + THUMB_LABEL_PX
}

/**
 * One page in the rail. The rail is virtualized, so a thumbnail exists only
 * near the rail's view and draws as soon as it mounts.
 */
export function PdfThumb({
  pdf,
  pageNumber,
  pageWidthPt,
  aspect,
  current,
  onSelect,
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  pageWidthPt: number
  /** Page height over width. */
  aspect: number
  current: boolean
  onSelect: (pageNumber: number) => void
}) {
  const intl = useIntl()
  const host = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let cancelled = false
    let task: RenderTask | null = null
    drawPage(pdf, pageNumber, THUMB_WIDTH / pageWidthPt, (t) => {
      task = t
    })
      .then(({ canvas }) => {
        if (!cancelled) host.current?.replaceChildren(canvas)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdf, pageNumber, pageWidthPt])

  return (
    <button
      type="button"
      aria-label={intl.formatMessage(
        { id: 'files.pdf.pageAria', defaultMessage: 'Page {number}' },
        { number: pageNumber }
      )}
      aria-current={current ? 'page' : undefined}
      onClick={() => onSelect(pageNumber)}
      className={cn(
        'flex cursor-pointer flex-col items-center gap-1.5 text-[11px] leading-4 text-muted-foreground',
        current && 'font-semibold text-foreground'
      )}
    >
      <span
        ref={host}
        className={cn(
          'relative block overflow-hidden rounded-[2px] bg-white outline outline-1 outline-border',
          current && 'outline-2 outline-blue-500'
        )}
        style={{ width: THUMB_WIDTH, height: Math.round(THUMB_WIDTH * aspect) }}
      />
      {pageNumber}
    </button>
  )
}
