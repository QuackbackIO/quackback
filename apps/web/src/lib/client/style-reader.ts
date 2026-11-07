/**
 * The loop's verifier in the builder: it reads the drawn preview's computed
 * styles for the elements a step said to check, in the off-screen check
 * frame, including states no pointer is in. A state such as hover is drawn
 * on demand: every rule of the page's own CSS that needs `:hover` (or
 * `:focus-visible`, `:active`) is copied with that pseudo-class swapped for
 * a data attribute, nested rules and their layers kept, so setting the
 * attribute on an element (and its ancestors, as a pointer would hover them)
 * draws its hover exactly as the page's CSS does, then is taken off again.
 */
import { composite, parseCssColour } from '@/lib/shared/design/agent/css-values'
import {
  elementOf,
  stateOf,
  targetKey,
  targetSelector,
  type StyleRegistry,
  type StyleTarget,
} from '@/lib/shared/design/agent/style-registry'
import type { ElementReading, Readings } from '@/lib/shared/design/agent/verify'

/** The attribute a forced state is drawn by. */
export const FORCE_ATTR = 'data-qb-force'

/** A stylesheet's rules, as much of them as forcing a state needs. */
export type CssNode =
  | { kind: 'style'; selector: string; declarations: string; children: CssNode[] }
  | { kind: 'decls'; declarations: string }
  | { kind: 'group'; prelude: string; children: CssNode[] }

const PSEUDO: Array<[RegExp, string]> = [
  [/:hover\b/g, `[${FORCE_ATTR}~="hover"]`],
  [/:focus-visible\b|:focus(?![-\w])/g, `[${FORCE_ATTR}~="focus"]`],
  [/:active\b/g, `[${FORCE_ATTR}~="pressed"]`],
]
const FORCEABLE = /:hover\b|:focus-visible\b|:focus(?![-\w])|:active\b/

/** A selector with its states swapped for the forcing attribute. */
export const forceSelector = (selector: string) =>
  PSEUDO.reduce((text, [pattern, attr]) => text.replace(pattern, attr), selector)

/** A nested selector in full: `&` as its parent, or a descendant of it. */
function resolve(selector: string, parent: string): string {
  if (!parent) return selector
  return selector.includes('&')
    ? selector.replace(/&/g, `:is(${parent})`)
    : `:is(${parent}) ${selector}`
}

/**
 * The CSS that draws forced states: each rule that needs one, its selector
 * swapped, inside the layers and conditions it was in. A media query that
 * asks whether the device can hover is dropped, since the state is forced.
 */
export function forcedStateCss(nodes: readonly CssNode[]): string {
  const out: string[] = []
  const walk = (list: readonly CssNode[], parent: string, groups: string[]) => {
    for (const node of list) {
      if (node.kind === 'group') {
        const hoverQuery = /^@media\b/.test(node.prelude) && /\bhover\b/.test(node.prelude)
        walk(node.children, parent, hoverQuery ? groups : [...groups, node.prelude])
        continue
      }
      const selector = node.kind === 'style' ? resolve(node.selector, parent) : parent
      if (node.declarations.trim() && FORCEABLE.test(selector)) {
        const rule = `${forceSelector(selector)} { ${node.declarations} }`
        out.push(groups.reduceRight((inner, prelude) => `${prelude} { ${inner} }`, rule))
      }
      if (node.kind === 'style' && node.children.length) walk(node.children, selector, groups)
    }
  }
  walk(nodes, '', [])
  return out.join('\n')
}

type AnyRule = CSSRule & {
  selectorText?: string
  style?: CSSStyleDeclaration
  cssRules?: CSSRuleList
  media?: MediaList
  conditionText?: string
  name?: string
  containerName?: string
  containerQuery?: string
}

/** A rule list as nodes; rules that are neither styles nor groups are left out. */
export function cssNodes(rules: CSSRuleList | readonly CSSRule[]): CssNode[] {
  const out: CssNode[] = []
  for (const raw of [...rules] as AnyRule[]) {
    const children = raw.cssRules ? cssNodes(raw.cssRules) : []
    if (raw.selectorText !== undefined && raw.style)
      out.push({
        kind: 'style',
        selector: raw.selectorText,
        declarations: raw.style.cssText,
        children,
      })
    else if (raw.style && raw.selectorText === undefined && !raw.cssRules)
      out.push({ kind: 'decls', declarations: raw.style.cssText })
    else if (raw.media)
      out.push({ kind: 'group', prelude: `@media ${raw.media.mediaText}`, children })
    else if (raw.containerQuery !== undefined)
      out.push({
        kind: 'group',
        prelude: `@container ${raw.containerName ?? ''} ${raw.containerQuery}`.replace(/\s+/g, ' '),
        children,
      })
    else if (raw.conditionText !== undefined)
      out.push({ kind: 'group', prelude: `@supports ${raw.conditionText}`, children })
    else if (raw.name !== undefined && raw.cssRules)
      out.push({ kind: 'group', prelude: `@layer ${raw.name}`, children })
  }
  return out
}

/** Every rule of a document's own sheets, as nodes. */
function documentNodes(doc: Document): CssNode[] {
  const out: CssNode[] = []
  for (const sheet of [...doc.styleSheets]) {
    try {
      out.push(...cssNodes(sheet.cssRules))
    } catch {
      // A sheet from another origin cannot be read; the portal's own are same-origin.
    }
  }
  return out
}

/** Animations and transitions held, so a forced state reads at once and not mid-way. */
const STILL = '*, *::before, *::after { transition: none !important; animation: none !important; }'

const visible = (el: Element, win: Window) => {
  const r = el.getBoundingClientRect()
  const cs = win.getComputedStyle(el)
  return r.width > 2 && r.height > 2 && cs.display !== 'none' && cs.visibility !== 'hidden'
}

/** The opaque colour behind an element: its ancestors' fills laid over one another, from the page up. */
function behindOf(el: Element, win: Window): string {
  const fills: Array<{ hex: string; alpha: number }> = []
  for (let at = el.parentElement; at; at = at.parentElement) {
    const fill = parseCssColour(win.getComputedStyle(at).backgroundColor)
    if (fill && fill.alpha > 0) {
      fills.push(fill)
      if (fill.alpha >= 0.999) break
    }
  }
  return fills.reduceRight<string>((under, fill) => composite(fill, under), '#ffffff')
}

function valuesOf(el: Element, win: Window, properties: readonly string[]): Record<string, string> {
  const cs = win.getComputedStyle(el)
  const size = parseFloat(cs.fontSize)
  const all: Record<string, () => string> = {
    background: () => cs.backgroundColor,
    color: () => cs.color,
    borderColor: () => cs.borderTopColor,
    borderWidth: () => cs.borderTopWidth,
    radius: () => cs.borderTopLeftRadius,
    shadow: () => cs.boxShadow,
    height: () => `${el.getBoundingClientRect().height}px`,
    size: () => cs.fontSize,
    weight: () => cs.fontWeight,
    tracking: () => cs.letterSpacing,
    leading: () =>
      cs.lineHeight === 'normal' ? '1.2' : String(+(parseFloat(cs.lineHeight) / size).toFixed(3)),
    case: () => cs.textTransform,
    underline: () => cs.textDecorationLine,
    lift: () => cs.getPropertyValue('translate') || 'none',
    opacity: () => cs.opacity,
    borderStyle: () => cs.borderTopStyle,
    paddingX: () => cs.paddingLeft,
    paddingY: () => cs.paddingTop,
    ring: () => cs.outlineColor,
    ringWidth: () => cs.outlineWidth,
  }
  // Always the colours, so readability can be judged on any target.
  const wanted = new Set([...properties, 'background', 'color'])
  return Object.fromEntries([...wanted].flatMap((p) => (all[p] ? [[p, all[p]!()]] : [])))
}

/**
 * Reads targets as drawn in a document: each element's values in its state,
 * a forced state drawn and taken off again. A target the page does not show
 * reads as not found.
 */
export function readStyleTargets(
  doc: Document,
  registry: StyleRegistry,
  targets: readonly StyleTarget[]
): Readings {
  const win = doc.defaultView
  const out: Readings = {}
  if (!win) return out
  const sheet = doc.createElement('style')
  sheet.setAttribute('data-qb-forced-states', '')
  sheet.textContent = `${STILL}\n${forcedStateCss(documentNodes(doc))}`
  doc.head.appendChild(sheet)
  try {
    for (const target of targets) {
      const element = elementOf(registry, target.element)
      const state = stateOf(registry, target.state)
      const missing: ElementReading = { found: false, values: {}, behind: null }
      if (!element || !state || !element.states.includes(target.state)) {
        out[targetKey(target)] = missing
        continue
      }
      // A forced state is found at rest and then forced; an attribute state is found in it.
      const find = targetSelector(registry, state.forced ? { ...target, state: 'base' } : target)!
      let el: Element | undefined
      try {
        el = [...doc.querySelectorAll(find)].find((each) => visible(each, win))
      } catch {
        el = undefined
      }
      if (!el) {
        out[targetKey(target)] = missing
        continue
      }
      const forced: Element[] = []
      if (state.forced)
        for (let at: Element | null = el; at && at !== doc.documentElement; at = at.parentElement) {
          at.setAttribute(FORCE_ATTR, state.forced)
          forced.push(at)
        }
      try {
        out[targetKey(target)] = {
          found: true,
          values: valuesOf(el, win, element.properties),
          behind: behindOf(el, win),
        }
      } finally {
        for (const at of forced) at.removeAttribute(FORCE_ATTR)
      }
    }
  } finally {
    sheet.remove()
  }
  return out
}

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

/**
 * Waits (up to `most`) until the frame draws the design whose preview CSS is
 * given: the frame takes a design by message and writes its CSS into one
 * style element, so that text matching is the sign it has drawn it.
 */
export async function waitForDrawn(
  frame: () => HTMLIFrameElement | null,
  css: string,
  { most = 3000, beat = 100 }: { most?: number; beat?: number } = {}
): Promise<boolean> {
  const began = Date.now()
  while (Date.now() - began < most) {
    const doc = frame()?.contentDocument
    const drawn = doc?.querySelector('style[data-preview-design]')?.textContent
    if (drawn === css) {
      await doc?.fonts?.ready
      // A frame for layout to follow the new styles.
      await pause(beat)
      return true
    }
    await pause(beat)
  }
  return false
}

/** Reads targets in the frame once it has drawn the design whose preview CSS is given. */
export async function readDrawn(
  frame: () => HTMLIFrameElement | null,
  registry: StyleRegistry,
  targets: readonly StyleTarget[],
  css: string,
  options?: { most?: number }
): Promise<Readings> {
  await waitForDrawn(frame, css, options)
  const doc = frame()?.contentDocument
  if (!doc) throw new Error('The preview is not there to read.')
  return readStyleTargets(doc, registry, targets)
}
