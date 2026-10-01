/**
 * PDFs, drawn with the pdf.js core API (no viewer, no annotation layer, no
 * scripting). Pages sit as white paper on the desk and are drawn only near
 * the viewport; a thumbnail rail tracks the current page; find searches each
 * page's text and highlights matches in the text layer. Encrypted or damaged
 * files are reported as unreadable, and closing the viewer destroys the
 * document and its worker.
 */
import './pdf-engine.css'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useIntl } from 'react-intl'
import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { ViewerEngineProps } from '../types'
import { withTimeout } from './budgets'
import { PdfFindBar } from './pdf-find-bar'
import {
  currentPage,
  findMatches,
  fitWidthZoom,
  PDF_TO_CSS,
  pageTextIndex,
  pageTops,
  pagesNear,
  pdfFailure,
  stepMatch,
  type TextMatch,
} from './pdf-layout'
import { PdfPage, PdfThumb, type PageText } from './pdf-page'
import { pdfDocumentParams } from './pdf-resources'
import { ZOOM_MAX, ZOOM_MIN, clampZoom } from './zoom'

// The worker is a file from our own build, served from this origin.
GlobalWorkerOptions.workerSrc = workerUrl

const PAGE_GAP = 16
/** Room for the desk's vertical scrollbar when fitting pages to its width. */
const SCROLLBAR_ALLOWANCE = 16
/** The thumbnail rail's width (`w-28`). */
const RAIL_WIDTH = 112
const FIND_DEBOUNCE_MS = 150

interface PageSize {
  /** PDF points, rotation applied. */
  width: number
  height: number
}

const NO_MATCHES: readonly TextMatch[] = []

export default function PdfEngine({ data, onToolbar, onError, compact }: ViewerEngineProps) {
  const intl = useIntl()
  const rootRef = useRef<HTMLDivElement>(null)
  const deskRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(1)
  const [current, setCurrent] = useState(1)
  const [visible, setVisible] = useState<ReadonlySet<number>>(() => new Set([1]))
  const [railVisible, setRailVisible] = useState<ReadonlySet<number>>(() => new Set([1]))
  const fail = useEffectEvent(onError)
  const report = useEffectEvent(onToolbar)
  const padding = compact ? 12 : 24

  // ---- Loading ------------------------------------------------------------

  const texts = useRef(new Map<number, Promise<PageText>>())

  useEffect(() => {
    setPdf(null)
    setSizes([])
    texts.current = new Map()
    if (!data) return
    let cancelled = false
    // pdf.js transfers the bytes to its worker; hand it a copy so the viewer
    // keeps its own for Download.
    const task: PDFDocumentLoadingTask = getDocument(
      pdfDocumentParams(new Uint8Array(data.slice(0)))
    )

    async function open() {
      const doc = await withTimeout(task.promise)
      const first = (await doc.getPage(1)).getViewport({ scale: 1 })
      if (cancelled) return
      // The rail appears with the document, so measure the whole engine less the rail.
      const deskWidth = (rootRef.current?.clientWidth ?? 0) - (compact ? 0 : RAIL_WIDTH)
      const fitted = fitWidthZoom(deskWidth, first.width, padding * 2 + SCROLLBAR_ALLOWANCE)
      setFit(fitted)
      setZoom(fitted)
      setCurrent(1)
      setSizes(
        Array.from({ length: doc.numPages }, () => ({ width: first.width, height: first.height }))
      )
      setPdf(doc)
      if (doc.numPages === 1) return
      // Mixed page sizes settle once every page's box is known.
      const all = await Promise.all(
        Array.from({ length: doc.numPages }, (_, i) =>
          doc.getPage(i + 1).then((page) => page.getViewport({ scale: 1 }))
        )
      )
      if (!cancelled) setSizes(all.map((v) => ({ width: v.width, height: v.height })))
    }

    // Destroying the task ends the document, its fonts and its worker.
    const close = () => task.destroy().catch(() => {})
    open().catch((error: unknown) => {
      if (cancelled) return
      void close()
      fail(pdfFailure(error))
    })
    return () => {
      cancelled = true
      // The text layer's measuring canvases live on the page body until released.
      void close().then(() => TextLayer.cleanup())
    }
  }, [data, padding, compact])

  const loadText = useCallback(
    (pageNumber: number): Promise<PageText> => {
      if (!pdf) return Promise.reject(new Error('No document'))
      let pending = texts.current.get(pageNumber)
      if (!pending) {
        pending = pdf
          .getPage(pageNumber)
          .then((page) => page.getTextContent())
          .then((content) => ({
            content,
            index: pageTextIndex(
              content.items.flatMap((item) =>
                'str' in item ? [{ str: item.str, hasEOL: item.hasEOL }] : []
              )
            ),
          }))
        texts.current.set(pageNumber, pending)
      }
      return pending
    },
    [pdf]
  )

  // ---- Geometry -----------------------------------------------------------

  const geometry = useMemo(() => {
    const scale = zoom * PDF_TO_CSS
    const widths = sizes.map((s) => s.width * scale)
    const heights = sizes.map((s) => s.height * scale)
    return { widths, heights, tops: pageTops(heights, padding, PAGE_GAP) }
  }, [sizes, zoom, padding])
  const geometryRef = useRef(geometry)
  useLayoutEffect(() => {
    geometryRef.current = geometry
  }, [geometry])

  // Keep the same spot of the same page in view across a zoom change.
  const anchor = useRef<{ zoom: number; tops: number[]; heights: number[] } | null>(null)
  useLayoutEffect(() => {
    const desk = deskRef.current
    const before = anchor.current
    const { tops, heights } = geometry
    if (
      desk &&
      before &&
      before.zoom !== zoom &&
      before.tops.length === tops.length &&
      tops.length
    ) {
      const index = currentPage(before.tops, before.heights, desk.scrollTop, desk.clientHeight) - 1
      const within = (desk.scrollTop - before.tops[index]!) / before.heights[index]!
      desk.scrollTop = tops[index]! + within * heights[index]!
      desk.scrollLeft *= zoom / before.zoom
    }
    anchor.current = { zoom, tops, heights }
  }, [geometry, zoom])

  useEffect(() => {
    const desk = deskRef.current
    if (!desk || !pdf) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const { tops, heights } = geometryRef.current
        setCurrent(currentPage(tops, heights, desk.scrollTop, desk.clientHeight))
      })
    }
    desk.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      desk.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [pdf])

  const go = useCallback(
    (page: number) => {
      const desk = deskRef.current
      const { tops } = geometryRef.current
      const target = Math.min(Math.max(1, Math.round(page)), tops.length)
      if (!desk || tops.length === 0) return
      desk.scrollTo({ top: tops[target - 1]! - padding / 2 })
      setCurrent(target)
    },
    [padding]
  )

  // ---- Which pages to draw --------------------------------------------------

  const deskObserver = useVisibility(deskRef, pdf, setVisible, '100% 0px')
  const railObserver = useVisibility(railRef, compact ? null : pdf, setRailVisible, '50% 0px')
  const total = pdf?.numPages ?? 0
  const drawnPages = useMemo(() => new Set(pagesNear(visible, total)), [visible, total])
  const drawnThumbs = useMemo(() => new Set(pagesNear(railVisible, total)), [railVisible, total])

  // ---- Find ---------------------------------------------------------------

  const [findOpen, setFindOpen] = useState(false)
  const [focusNonce, setFocusNonce] = useState(0)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<readonly TextMatch[]>(NO_MATCHES)
  const [activeMatch, setActiveMatch] = useState(-1)
  const [revealNonce, setRevealNonce] = useState(0)
  const [searching, setSearching] = useState(false)

  const reveal = useCallback(
    (index: number, list: readonly TextMatch[]) => {
      setActiveMatch(index)
      setRevealNonce((n) => n + 1)
      const match = list[index]
      // A page off screen has no text layer yet: bring it in, and it scrolls
      // its highlighted match into view once drawn.
      if (match && !drawnPages.has(match.page)) go(match.page)
    },
    [drawnPages, go]
  )
  const revealMatch = useEffectEvent(reveal)

  useEffect(() => {
    if (!pdf || !findOpen || query.trim() === '') {
      setMatches(NO_MATCHES)
      setActiveMatch(-1)
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      Promise.all(
        Array.from({ length: pdf.numPages }, (_, i) => loadText(i + 1).then((t) => t.index.text))
      )
        .then((pageTexts) => {
          if (cancelled) return
          const found = findMatches(pageTexts, query)
          setMatches(found)
          setSearching(false)
          if (found.length > 0) revealMatch(0, found)
          else setActiveMatch(-1)
        })
        .catch(() => {
          if (!cancelled) setSearching(false)
        })
    }, FIND_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [pdf, findOpen, query, loadText])

  const step = useCallback(
    (direction: 1 | -1) => {
      const next = stepMatch(activeMatch, matches.length, direction)
      if (next >= 0) reveal(next, matches)
    },
    [activeMatch, matches, reveal]
  )

  const openFind = useCallback(() => {
    setFindOpen(true)
    setFocusNonce((n) => n + 1)
  }, [])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    deskRef.current?.focus()
  }, [])

  const matchesByPage = useMemo(() => {
    const byPage = new Map<number, { list: TextMatch[]; first: number }>()
    matches.forEach((match, i) => {
      const entry = byPage.get(match.page)
      if (entry) entry.list.push(match)
      else byPage.set(match.page, { list: [match], first: i })
    })
    return byPage
  }, [matches])

  // ---- Toolbar ------------------------------------------------------------

  const changeZoom = useCallback((value: number) => setZoom(clampZoom(value, fit)), [fit])

  useEffect(() => {
    if (!pdf) return
    report({
      zoom: { value: zoom, min: Math.min(ZOOM_MIN, fit), max: ZOOM_MAX, set: changeZoom },
      page: { current, total: pdf.numPages, go },
      find: { open: openFind },
    })
  }, [pdf, zoom, fit, changeZoom, current, go, openFind])

  // ---- Render -------------------------------------------------------------

  return (
    <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1">
      {!compact && pdf && (
        <nav
          ref={railRef}
          aria-label={intl.formatMessage({ id: 'files.pdf.railAria', defaultMessage: 'Pages' })}
          className="flex w-28 shrink-0 flex-col items-center gap-3.5 overflow-y-auto border-r border-border bg-background px-3 py-3.5"
        >
          {sizes.map((size, i) => (
            <PdfThumb
              key={i + 1}
              pdf={pdf}
              pageNumber={i + 1}
              pageWidthPt={size.width}
              aspect={size.height / size.width}
              drawn={drawnThumbs.has(i + 1)}
              current={current === i + 1}
              onSelect={go}
              register={railObserver}
            />
          ))}
        </nav>
      )}
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {findOpen && pdf && (
          <PdfFindBar
            query={query}
            onQuery={setQuery}
            count={matches.length}
            active={activeMatch}
            searching={searching}
            onStep={step}
            onClose={closeFind}
            focusNonce={focusNonce}
          />
        )}
        <div
          ref={deskRef}
          tabIndex={-1}
          className="min-h-0 min-w-0 flex-1 overflow-auto bg-[oklch(0.935_0_0)] outline-none dark:bg-[oklch(0.11_0_0)]"
        >
          {pdf && (
            <div
              className="mx-auto flex w-max min-w-full flex-col items-center"
              style={{ padding, gap: PAGE_GAP }}
            >
              {sizes.map((_, i) => {
                const pageNumber = i + 1
                const pageMatches = matchesByPage.get(pageNumber)
                const active = pageMatches ? activeMatch - pageMatches.first : -1
                return (
                  <PdfPage
                    key={pageNumber}
                    pdf={pdf}
                    pageNumber={pageNumber}
                    width={geometry.widths[i]!}
                    height={geometry.heights[i]!}
                    zoom={zoom}
                    drawn={drawnPages.has(pageNumber)}
                    loadText={loadText}
                    matches={pageMatches?.list ?? NO_MATCHES}
                    activeMatch={pageMatches && active < pageMatches.list.length ? active : -1}
                    revealNonce={revealNonce}
                    register={deskObserver}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Tracks which pages (elements registered with their page number) are near a
 * scrolling root, and returns the registration callback.
 */
function useVisibility(
  rootRef: React.RefObject<HTMLElement | null>,
  active: unknown,
  onChange: (pages: ReadonlySet<number>) => void,
  rootMargin: string
): (pageNumber: number, el: HTMLElement | null) => void {
  const elements = useRef(new Map<number, HTMLElement>())
  const observer = useRef<IntersectionObserver | null>(null)
  const report = useEffectEvent(onChange)

  useEffect(() => {
    const root = rootRef.current
    if (!root || !active) return
    const near = new Set<number>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page)
          if (entry.isIntersecting) near.add(page)
          else near.delete(page)
        }
        report(new Set(near))
      },
      { root, rootMargin }
    )
    for (const el of elements.current.values()) io.observe(el)
    observer.current = io
    return () => {
      io.disconnect()
      observer.current = null
    }
  }, [rootRef, active, rootMargin])

  return useCallback((pageNumber: number, el: HTMLElement | null) => {
    const previous = elements.current.get(pageNumber)
    if (previous && previous !== el) observer.current?.unobserve(previous)
    if (el) {
      elements.current.set(pageNumber, el)
      observer.current?.observe(el)
    } else {
      elements.current.delete(pageNumber)
    }
  }, [])
}
