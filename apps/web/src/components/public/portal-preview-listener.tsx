import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { extractCssVariables, loadBrandingFont, normalizeFontSans } from '@/lib/shared/theme'
import { PreviewDraftProvider, type PortalPreviewDraft } from './preview-draft-context'

type StructuralDraft = Omit<PortalPreviewDraft, 'css'>

/** A draft portal design, resolved by the admin with the code the server uses. */
interface DesignPreview {
  css: string
  attributes: Record<string, string>
  fontIds: string[]
}

const DESIGN_ATTRIBUTE = /^data-qb-[a-z]+$/
const DESIGN_VALUE = /^[a-z_]+$/

/** The message's design, keeping only the structural attributes a design sets. */
function readDesignPreview(value: unknown): DesignPreview | null {
  if (!value || typeof value !== 'object') return null
  const { css, attributes, fontIds } = value as Record<string, unknown>
  if (typeof css !== 'string') return null
  const safe = Object.fromEntries(
    Object.entries((attributes as Record<string, unknown>) ?? {}).filter(
      ([name, v]) => DESIGN_ATTRIBUTE.test(name) && typeof v === 'string' && DESIGN_VALUE.test(v)
    )
  ) as Record<string, string>
  const fonts = Array.isArray(fontIds) ? fontIds.filter((id) => typeof id === 'string') : []
  return { css, attributes: safe, fontIds: fonts }
}

/**
 * Sets a draft design's attributes on <html> and puts each one's saved value
 * back when the draft changes or ends.
 */
function useDesignAttributes(attributes: Record<string, string> | undefined) {
  useEffect(() => {
    if (!attributes) return
    const root = document.documentElement
    const saved = Object.keys(attributes).map((name) => [name, root.getAttribute(name)] as const)
    for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value)
    return () => {
      for (const [name, value] of saved) {
        if (value === null) root.removeAttribute(name)
        else root.setAttribute(name, value)
      }
    }
  }, [attributes])
}

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
 * Mounted from the portal layout ONLY when the document is loaded with
 * `?preview=1` inside a same-origin iframe (the admin live preview). It
 * listens for postMessage from the parent and exposes two draft channels:
 *
 * - `quackback:preview-css`: the theme editor's full draft stylesheet,
 *   rendered into a <style> AFTER the children so it cascades over the
 *   loader-injected theme styles and custom CSS.
 * - `quackback:preview-draft`: structural drafts (nav config, welcome card,
 *   header identity) provided via PreviewDraftContext for draft-aware
 *   components (PortalHeader, the welcome card render site).
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
  const [design, setDesign] = useState<DesignPreview | null>(null)

  // Only a framed, explicitly preview-flagged document listens.
  const active = enabled && typeof window !== 'undefined' && window.self !== window.top

  useEffect(() => {
    if (!active) return
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const msg = event.data as
        { type?: string; css?: unknown; draft?: unknown; design?: unknown } | null | undefined
      if (msg?.type === 'quackback:preview-design') {
        setDesign(readDesignPreview(msg.design))
      } else if (msg?.type === 'quackback:preview-css' && typeof msg.css === 'string') {
        setCss(msg.css)
      } else if (msg?.type === 'quackback:preview-draft' && msg.draft) {
        const incoming = msg.draft as StructuralDraft
        setDraft((prev) => nextDraft(prev, incoming))
      }
    }
    window.addEventListener('message', onMessage)
    // Tell the parent we're ready so it re-sends current drafts after a remount.
    window.parent.postMessage({ type: 'quackback:preview-ready' }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [active])

  const stylesheet = useMemo(() => (css ? previewStylesheet(css) : ''), [css])
  useDesignAttributes(design?.attributes)
  const fontIds = design?.fontIds.join(' ') ?? ''
  useEffect(() => {
    for (const id of fontIds.split(' ').filter(Boolean)) loadBrandingFont(id).catch(() => {})
  }, [fontIds])

  if (!enabled) return <>{children}</>

  return (
    <PreviewDraftProvider draft={draft} css={css}>
      {children}
      {stylesheet ? <style data-preview-override="">{stylesheet}</style> : null}
      {design?.css ? <style data-preview-design="">{design.css}</style> : null}
    </PreviewDraftProvider>
  )
}
