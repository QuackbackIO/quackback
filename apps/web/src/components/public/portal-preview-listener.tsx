import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouteContext, useRouter } from '@tanstack/react-router'
import { extractCssVariables, loadBrandingFont, normalizeFontSans } from '@/lib/shared/theme'
import { BrandStatusColours } from './brand-status-colours'
import {
  FeedCopyContext,
  PREVIEW_THEME,
  PreviewDraftProvider,
  PreviewDesignContext,
  PreviewSamplesContext,
  type DraftDesignView,
  type PortalPreviewDraft,
} from './preview-draft-context'

type StructuralDraft = Omit<PortalPreviewDraft, 'css'>

type DesignChannel = typeof import('./portal-preview-design')
type DesignerChannel = typeof import('./portal-preview-designer')

const sameContent = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/**
 * The next structural draft, keeping each field that did not change as the
 * very object it was. Every message carries the whole draft, so without this
 * an edit to the welcome card would hand the header a new navigation too.
 */
function nextDraft(prev: StructuralDraft | null, next: StructuralDraft): StructuralDraft {
  const nav = sameContent(prev?.nav, next.nav) ? prev?.nav : next.nav
  const welcomeCard = sameContent(prev?.welcomeCard, next.welcomeCard)
    ? prev?.welcomeCard
    : next.welcomeCard
  return prev && nav === prev.nav && welcomeCard === prev.welcomeCard ? prev : { nav, welcomeCard }
}

/**
 * The draft stylesheet as the portal applies a saved theme. The saved theme
 * also sets the font and radius on `body`, and the font family itself with
 * `!important`, which beat a draft that sets them on `:root` alone; so the
 * draft's light values are declared there too. They go ahead of the draft's
 * own text, whose custom rules then win, as saved custom CSS does.
 */
function previewStylesheet(css: string): string {
  const { light } = extractCssVariables(css)
  const fontSans = light['--font-sans'] ? normalizeFontSans(light['--font-sans']) : null
  const radius = light['--radius'] ?? null
  const bodyVars = [
    fontSans ? `--font-sans: ${fontSans}` : null,
    radius ? `--radius: ${radius}` : null,
  ].filter(Boolean)
  return [
    bodyVars.length > 0 ? `body { ${bodyVars.join('; ')}; }` : null,
    fontSans ? `html body { font-family: ${fontSans} !important; }` : null,
    css,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Bridge between the admin Branding page and the portal preview iframe.
 *
 * Mounted by the portal layout on every page, where it provides what pages
 * take from the design in force (its wording and status colours). Only when
 * the document is loaded with `?preview=true` inside a same-origin iframe
 * (the admin live preview) does it listen for postMessage from the parent,
 * on these draft channels:
 *
 * - `quackback:preview-css`: the theme editor's full draft stylesheet,
 *   rendered into a <style> AFTER the children so it cascades over the
 *   loader-injected theme styles and custom CSS.
 * - `quackback:preview-draft`: structural drafts (nav config, welcome card,
 *   header identity) provided via PreviewDraftContext for draft-aware
 *   components (PortalHeader, the welcome card render site).
 * - `quackback:preview-design`: the builder's whole draft design. The frame
 *   reads it with the design schema and builds its view with designView, as
 *   the server builds the published one, then provides that view where the
 *   portal reads the published view (usePortalDesign). Nothing in the portal
 *   reads a draft any other way.
 *
 * CSS is applied via a text node (never innerHTML) and both sides verify
 * the message origin, so a hostile page cannot inject anything executable.
 */
export function PortalPreviewProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const [css, setCss] = useState('')
  const [draft, setDraft] = useState<StructuralDraft | null>(null)
  const [design, setDesign] = useState<DraftDesignView | null>(null)
  const designChannel = useRef<DesignChannel | null>(null)
  // The design drawn now, which an equal one sent again keeps.
  const shownDesign = useRef<DraftDesignView | null>(null)
  // In the designer: its own click handling; the builder draws what is picked.
  const [designer, setDesigner] = useState<DesignerChannel | null>(null)
  // Trying the page as a visitor: clicks act, nothing is picked or written.
  const [trying, setTrying] = useState(false)

  // Only a framed, explicitly preview-flagged document listens.
  const active = enabled && typeof window !== 'undefined' && window.self !== window.top
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router

  useEffect(() => {
    if (!active) return
    function onMessage(event: MessageEvent) {
      // Only the page that frames this one may draw into it, not another tab or frame.
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      const msg = event.data as
        { type?: string; css?: unknown; draft?: unknown; design?: unknown } | null | undefined
      if (msg?.type === 'quackback:preview-designer') {
        setTrying((msg as { trying?: unknown }).trying === true)
        void import('./portal-preview-designer').then((channel) => setDesigner(() => channel))
      } else if (msg?.type === 'quackback:preview-design') {
        const value = msg.design
        void import('./portal-preview-design').then((channel) => {
          designChannel.current = channel
          const next = channel.sharedView(shownDesign.current, channel.readDraftView(value))
          if (next && next === shownDesign.current) {
            // Already drawn: the builder may send its next design at once.
            window.parent.postMessage({ type: 'quackback:preview-drawn' }, window.location.origin)
            return
          }
          shownDesign.current = next
          setDesign(next)
        })
      } else if (msg?.type === PREVIEW_THEME) {
        // Light or dark, in place: the address says which, as the frame was loaded with it,
        // and the page keeps its scroll and what it drew.
        const theme = (msg as { theme?: unknown }).theme
        const shown = new URLSearchParams(window.location.search).get('theme')
        if ((theme === 'light' || theme === 'dark') && theme !== shown)
          void routerRef.current.navigate({
            to: '.',
            search: (prev) => ({ ...prev, theme }),
            replace: true,
            resetScroll: false,
          })
      } else if (msg?.type === 'quackback:preview-css' && typeof msg.css === 'string') {
        setCss(msg.css)
      } else if (msg?.type === 'quackback:preview-draft' && msg.draft) {
        const incoming = msg.draft as StructuralDraft
        setDraft((prev) => nextDraft(prev, incoming))
      }
    }
    window.addEventListener('message', onMessage)
    // Tell the parent we're ready so it re-sends current drafts after a remount,
    // and where the page is, so Preview can follow it from the first moment.
    window.parent.postMessage(
      { type: 'quackback:preview-ready', path: window.location.pathname },
      window.location.origin
    )
    return () => window.removeEventListener('message', onMessage)
  }, [active])

  // Once a draft design is drawn, the frame says so: until then it shows the published one.
  useEffect(() => {
    if (!active || !design) return
    window.parent.postMessage({ type: 'quackback:preview-drawn' }, window.location.origin)
  }, [active, design])

  const stylesheet = useMemo(() => (css ? previewStylesheet(css) : ''), [css])
  // Built once per design drawn, not on every render of the page around it.
  const designSheet = useMemo(
    () => (design && designChannel.current ? designChannel.current.draftStylesheet(design) : ''),
    [design]
  )
  // While a draft is previewed: its attributes on <html> (the saved ones come
  // back when they change), and a click on a section tells Appearance which.
  const attributes = design?.attributes
  useEffect(() => {
    const channel = designChannel.current
    if (!attributes || !channel) return
    const restore = channel.applyDesignAttributes(attributes)
    const stopPicking = active && !designer ? channel.startSectionPicking() : () => {}
    return () => {
      restore()
      stopPicking()
    }
  }, [attributes, active, designer])
  useEffect(
    () =>
      active && designer
        ? trying
          ? designer.startTrying()
          : designer.startDesigning()
        : undefined,
    [active, designer, trying]
  )
  // The designer's frame says so in its address: until designing starts, a click
  // or a form does nothing, so nothing navigates or posts in the first moment.
  useEffect(() => {
    if (!active || designer || !new URLSearchParams(window.location.search).has('designer')) return
    const hold = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      // Escape still reaches the designer, so Preview can be left while this loads.
      if (event instanceof KeyboardEvent && event.key === 'Escape')
        window.parent.postMessage(
          { type: 'quackback:preview-key', key: 'escape' },
          window.location.origin
        )
    }
    for (const type of ['click', 'submit', 'keydown'] as const)
      document.addEventListener(type, hold, true)
    return () => {
      for (const type of ['click', 'submit', 'keydown'] as const)
        document.removeEventListener(type, hold, true)
    }
  }, [active, designer])
  const fontIds = design?.fontIds.join(' ') ?? ''
  useEffect(() => {
    for (const id of fontIds.split(' ').filter(Boolean)) loadBrandingFont(id).catch(() => {})
  }, [fontIds])

  // What every page takes from the design in force: the draft's in the frame, else the published one.
  const saved = useRouteContext({
    from: '__root__',
    select: (context) => context.settings?.portalDesign,
  })
  const shown = design ?? (saved?.engine === 'v2' ? saved : undefined)
  const page = (
    <FeedCopyContext.Provider value={shown?.feedback.copy}>
      <BrandStatusColours colours={shown?.statusColours}>{children}</BrandStatusColours>
    </FeedCopyContext.Provider>
  )

  if (!enabled) return page

  return (
    <PreviewDraftProvider draft={draft} css={css}>
      <PreviewDesignContext.Provider value={design ?? undefined}>
        <PreviewSamplesContext.Provider value={!!designer && !trying}>
          {page}
        </PreviewSamplesContext.Provider>
      </PreviewDesignContext.Provider>
      {stylesheet ? <style data-preview-override="">{stylesheet}</style> : null}
      {designSheet ? <style data-preview-design="">{designSheet}</style> : null}
      {designer ? <style data-preview-designer="">{designer.DESIGNER_CSS}</style> : null}
      {/* Appearance's own hover outline; in the designer the builder draws it. */}
      {design && designChannel.current && !designer ? (
        <style data-preview-sections="">{designChannel.current.SECTION_OUTLINE_CSS}</style>
      ) : null}
    </PreviewDraftProvider>
  )
}
