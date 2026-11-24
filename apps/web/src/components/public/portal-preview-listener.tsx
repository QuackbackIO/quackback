import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { normalizeFontSans } from '@/lib/shared/theme'
import { customFontStack, headingFontStack, themeExtrasCss } from '@/lib/shared/theme/generator'
import { extractCssVariables } from '@/lib/shared/theme/css-parser'
import { parseCssToMinimal } from '@/lib/shared/theme/readable-css'
import {
  PreviewDraftProvider,
  PreviewEditModeProvider,
  type PortalPreviewDraft,
  type PreviewEditLabels,
  type PreviewEditTarget,
} from './preview-draft-context'

type StructuralDraft = Omit<PortalPreviewDraft, 'css'>

const STRUCTURAL_KEYS = [
  'nav',
  'welcomeCard',
  'helpCenter',
  'logo',
  'buttonShape',
  'customFont',
  'cardStyle',
  'customHeadingFont',
  'headingScope',
  'name',
] as const

const sameContent = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/**
 * The next structural draft, keeping each field that did not change as the
 * very object it was. Every message carries the whole draft, so without this
 * an edit to the welcome card would hand the header a new navigation too.
 * Fields this frame does not know are dropped.
 */
function nextDraft(prev: StructuralDraft | null, next: StructuralDraft): StructuralDraft {
  const out: Record<string, unknown> = {}
  let unchanged = prev !== null
  for (const key of STRUCTURAL_KEYS) {
    const kept = sameContent(prev?.[key], next[key]) ? prev?.[key] : next[key]
    if (kept !== prev?.[key]) unchanged = false
    if (kept !== undefined) out[key] = kept
  }
  return unchanged && prev ? prev : (out as StructuralDraft)
}

/**
 * The draft stylesheet as the portal applies a saved theme. The saved theme
 * also sets the font and radius on `body`, and the font family itself with
 * `!important`, which beat a draft that sets them on `:root` alone; so the
 * draft's light values are declared there too. They go ahead of the draft's
 * own text, whose custom rules then win, as saved custom CSS does.
 */
function previewStylesheet(
  css: string,
  uploadedStack: string | null,
  heading: string | null
): string {
  const { light } = extractCssVariables(css)
  // An uploaded family leads the stack, as the live theme writes it.
  const fontSans =
    uploadedStack ?? (light['--font-sans'] ? normalizeFontSans(light['--font-sans']) : null)
  const radius = light['--radius'] ?? null
  const bodyVars = [
    fontSans ? `--font-sans: ${fontSans}` : null,
    radius ? `--radius: ${radius}` : null,
    // On the body too: the saved theme sets a headings font on :root and
    // .dark, which a draft with another (or none) must beat on both.
    heading ? `--font-heading: ${heading}` : null,
  ].filter(Boolean)
  return [
    bodyVars.length > 0 ? `body { ${bodyVars.join('; ')}; }` : null,
    fontSans ? `html body { font-family: ${fontSans} !important; }` : null,
    css,
  ]
    .filter(Boolean)
    .join('\n')
}

/** How long a change's outlines stay, in milliseconds. */
const FLASH_MS = 1500
/** A change that touches more parts than this gets no outlines at all. */
const FLASH_MAX = 3

/** The closest an outline comes to the page's edge, so its ring still shows. */
const FLASH_EDGE = 3

/** The targets of a flash message: a short list of plain names, or nothing. */
function flashTargetsOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > FLASH_MAX) return []
  return value.every((name) => typeof name === 'string' && /^[a-z][a-z-]*$/.test(name))
    ? [...new Set(value as string[])]
    : []
}

const postToParent = (message: Record<string, unknown>) =>
  window.parent.postMessage(message, window.location.origin)

/** The innermost edit target at or around a node, if any. */
function editTargetOf(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>('[data-qb-edit]') : null
}

/**
 * Bridge between the admin Customise page and the portal preview iframe.
 *
 * Mounted from the portal layout ONLY when the document is loaded with
 * `?preview=1` inside a same-origin iframe (the admin live preview). It
 * listens for postMessage from its parent window and exposes these channels:
 *
 * - `quackback:preview-css`: the theme editor's full draft stylesheet,
 *   rendered into a <style> AFTER the children so it cascades over the
 *   loader-injected theme styles and custom CSS.
 * - `quackback:preview-draft`: structural drafts (nav, welcome card, Help
 *   Center home, logo, button shape) provided via PreviewDraftContext for
 *   draft-aware components.
 * - `quackback:preview-edit-mode`: makes `data-qb-edit` parts clickable. A
 *   click on one posts `quackback:preview-pick` instead of following it.
 * - `quackback:preview-flash`: outlines up to three `data-qb-edit` parts for
 *   a moment, to show where a change landed.
 *
 * It tells the parent `quackback:preview-ready` once listening and
 * `quackback:preview-location` on every page it shows.
 *
 * CSS is applied via a text node (never innerHTML), and both sides check the
 * message's origin and its window, so another page or frame cannot inject
 * anything or pose as the preview.
 */
export function PortalPreviewProvider({
  enabled,
  path,
  children,
}: {
  enabled: boolean
  /** The page the frame shows, reported to the parent as it changes. */
  path?: string
  children: ReactNode
}) {
  const [css, setCss] = useState('')
  const [draft, setDraft] = useState<StructuralDraft | null>(null)
  const [editLabels, setEditLabels] = useState<PreviewEditLabels | null>(null)
  // The parts to outline now; a new object for each change, so one restarts.
  const [flash, setFlash] = useState<{ targets: string[] } | null>(null)

  // Only a framed, explicitly preview-flagged document listens.
  const active = enabled && typeof window !== 'undefined' && window.self !== window.top

  useEffect(() => {
    if (!active) return
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      const msg = event.data as
        | {
            type?: string
            css?: unknown
            draft?: unknown
            enabled?: unknown
            labels?: unknown
            targets?: unknown
          }
        | null
        | undefined
      if (msg?.type === 'quackback:preview-css' && typeof msg.css === 'string') {
        setCss(msg.css)
      } else if (msg?.type === 'quackback:preview-draft' && msg.draft) {
        const incoming = msg.draft as StructuralDraft
        setDraft((prev) => nextDraft(prev, incoming))
      } else if (msg?.type === 'quackback:preview-edit-mode') {
        const labels = msg.labels && typeof msg.labels === 'object' ? msg.labels : {}
        setEditLabels(msg.enabled === true ? (labels as PreviewEditLabels) : null)
      } else if (msg?.type === 'quackback:preview-flash') {
        const targets = flashTargetsOf(msg.targets)
        setFlash(targets.length > 0 ? { targets } : null)
      }
    }
    window.addEventListener('message', onMessage)
    // Tell the parent we're ready so it re-sends current drafts after a remount.
    postToParent({ type: 'quackback:preview-ready' })
    return () => window.removeEventListener('message', onMessage)
  }, [active])

  useEffect(() => {
    if (active && path !== undefined) postToParent({ type: 'quackback:preview-location', path })
  }, [active, path])

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flash])

  // In edit mode a click on a target opens its section instead of navigating.
  const editing = active && editLabels !== null
  useEffect(() => {
    if (!editing) return
    function onClick(event: MouseEvent) {
      const target = editTargetOf(event.target)
      if (!target) return
      event.preventDefault()
      event.stopPropagation()
      postToParent({ type: 'quackback:preview-pick', target: target.dataset.qbEdit })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [editing])

  const stylesheet = useMemo(() => {
    const parsed = extractCssVariables(css)
    const extras = themeExtrasCss(
      {
        buttonShape: draft?.buttonShape,
        customFont: draft?.customFont,
        customHeadingFont: draft?.customHeadingFont,
        headingScope: draft?.headingScope,
        // The card style is worked out from the colours the draft sets, so
        // it is written only with a draft stylesheet (the editor sends one
        // whenever the style differs from the saved one). Without one the
        // frame shows the saved theme, whose card variables are its own.
        cardStyle: css ? draft?.cardStyle : undefined,
        light: parseCssToMinimal(parsed.light),
        dark: parseCssToMinimal(parsed.dark),
      },
      { explicit: true }
    )
    const stack = customFontStack(draft?.customFont)
    // The headings font the draft sets: an uploaded family over the text
    // font (worked out on the body, where the text font is set), else the
    // stylesheet's own; a structural draft with neither says the text font,
    // over whatever is saved.
    const listed = parsed.light['--font-heading'] ?? parsed.dark['--font-heading']
    const heading =
      headingFontStack(draft?.customHeadingFont, 'var(--font-sans)') ??
      (listed ? normalizeFontSans(listed) : draft && css ? 'initial' : null)
    // An uploaded font applies even with no stylesheet draft (its fallback
    // may be the font already in use, which leaves the stylesheet as it was).
    return [css || stack || heading ? previewStylesheet(css, stack, heading) : '', extras]
      .filter(Boolean)
      .join('\n')
  }, [css, draft])

  if (!enabled) return <>{children}</>

  return (
    <PreviewDraftProvider draft={draft} css={css}>
      <PreviewEditModeProvider labels={editing ? editLabels : null}>
        {children}
        {editing ? <EditHighlight labels={editLabels} /> : null}
        {active && flash ? <FlashOutlines targets={flash.targets} /> : null}
      </PreviewEditModeProvider>
      {stylesheet ? <style data-preview-override="">{stylesheet}</style> : null}
    </PreviewDraftProvider>
  )
}

interface Highlight {
  rect: DOMRect
  label: string | undefined
}

/**
 * The outline around the part under the pointer, with its section's name in
 * a chip outside the outline. Drawn over the page, never in it, and it never
 * takes the pointer, so the page lays out exactly as it does live.
 */
function EditHighlight({ labels }: { labels: PreviewEditLabels | null }) {
  const [hovered, setHovered] = useState<HTMLElement | null>(null)
  const [highlight, setHighlight] = useState<Highlight | null>(null)

  useEffect(() => {
    const onOver = (event: PointerEvent) => setHovered(editTargetOf(event.target))
    const onLeave = () => setHovered(null)
    document.addEventListener('pointerover', onOver)
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      document.removeEventListener('pointerover', onOver)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  useEffect(() => {
    if (!hovered) {
      setHighlight(null)
      return
    }
    const measure = () =>
      setHighlight({
        rect: hovered.getBoundingClientRect(),
        label: labels?.[hovered.dataset.qbEdit as PreviewEditTarget],
      })
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [hovered, labels])

  if (!highlight) return null
  const { rect, label } = highlight
  const chipAbove = rect.top >= 24
  return (
    <div aria-hidden="true" style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'fixed',
          zIndex: 2147483646,
          left: rect.left - 2,
          top: rect.top - 2,
          width: rect.width + 4,
          height: rect.height + 4,
          outline: '2px solid #2563eb',
          borderRadius: 6,
          pointerEvents: 'none',
        }}
      />
      {label ? (
        <div
          style={{
            position: 'fixed',
            zIndex: 2147483647,
            left: Math.max(rect.left - 2, 4),
            top: chipAbove ? rect.top - 24 : rect.bottom + 4,
            padding: '2px 8px',
            borderRadius: 4,
            background: '#2563eb',
            color: '#ffffff',
            font: '500 11px/16px ui-sans-serif, system-ui, sans-serif',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  )
}

const FLASH_CSS = `@keyframes qb-preview-flash { 0% { opacity: 0 } 12% { opacity: 1 } 70% { opacity: 1 } 100% { opacity: 0 } }
[data-preview-flash] { animation: qb-preview-flash ${FLASH_MS}ms ease-out both }
@media (prefers-reduced-motion: reduce) { [data-preview-flash] { animation: none } }`

/** The first part with this name that the page actually shows. */
function shownTarget(name: string): DOMRect | null {
  for (const element of document.querySelectorAll(`[data-qb-edit="${name}"]`)) {
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return rect
  }
  return null
}

/**
 * Outlines around the parts a change landed on, one element for each name.
 * Drawn over the page by the page itself, so they sit right at any device
 * width or scale, and they follow the parts while the new look settles.
 * With reduced motion they hold still instead of fading.
 */
function FlashOutlines({ targets }: { targets: string[] }) {
  const [boxes, setBoxes] = useState<Array<{ name: string; rect: DOMRect }>>([])

  // Before paint, so the outlines appear with the change they point at.
  useLayoutEffect(() => {
    const measure = () =>
      setBoxes(
        targets.flatMap((name) => {
          const rect = shownTarget(name)
          return rect ? [{ name, rect }] : []
        })
      )
    measure()
    // The draft that came with the flash may still be laying out (a font, a logo).
    const settle = window.setInterval(measure, 150)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.clearInterval(settle)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [targets])

  return (
    <div aria-hidden="true" style={{ pointerEvents: 'none' }}>
      <style>{FLASH_CSS}</style>
      {boxes.map(({ name, rect }) => {
        // Just outside the part, but never off the page: a bar as wide as
        // the page would otherwise show only its bottom edge.
        const left = Math.max(rect.left - 2, FLASH_EDGE)
        const top = Math.max(rect.top - 2, FLASH_EDGE)
        const right = Math.min(rect.right + 2, window.innerWidth - FLASH_EDGE)
        const bottom = Math.min(rect.bottom + 2, window.innerHeight - FLASH_EDGE)
        return (
          <div
            key={name}
            data-preview-flash={name}
            style={{
              position: 'fixed',
              zIndex: 2147483645,
              left,
              top,
              width: right - left,
              height: bottom - top,
              borderRadius: 8,
              boxShadow: '0 0 0 2px #3b82f6, 0 0 0 6px rgba(59, 130, 246, 0.22)',
              pointerEvents: 'none',
            }}
          />
        )
      })}
    </div>
  )
}
