/**
 * A small CSS cascade over a page's rules, as a wide, light screen first shows
 * them: rules are filed by what their last compound needs, matched against an
 * element's tag, id and classes, and ordered by specificity then source order.
 */
export interface Rule {
  selectors: string[]
  decls: Map<string, string>
  order: number
}

/** Rules at the top level and in queries that hold on a wide, light screen. */
export function parseRules(css: string): Rule[] {
  const rules: Rule[] = []
  let order = 0
  const walk = (text: string, skip: boolean) => {
    let i = 0
    while (i < text.length) {
      const open = text.indexOf('{', i)
      if (open < 0) break
      const prelude = text
        .slice(i, open)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim()
      // Find the matching close brace.
      let depth = 1
      let j = open + 1
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++
        else if (text[j] === '}') depth--
        j++
      }
      const body = text.slice(open + 1, j - 1)
      if (prelude.startsWith('@')) {
        const at = prelude.toLowerCase()
        // Small screens, dark themes, print, touch, wide-gamut repaints and tests
        // that single out one browser engine are not a wide, light screen.
        const narrow =
          /max-width|prefers-color-scheme:\s*dark|print|hover:\s*none|pointer:\s*coarse|color-gamut|forced-colors|-webkit-touch-callout|-moz-/.test(
            at
          )
        if (/^@(media|supports|layer|container)/.test(at)) walk(body, skip || narrow)
      } else if (!skip && prelude) {
        const decls = new Map<string, string>()
        for (const part of body.split(';')) {
          const colon = part.indexOf(':')
          if (colon < 0) continue
          decls.set(
            part.slice(0, colon).trim().toLowerCase(),
            part
              .slice(colon + 1)
              .replace(/!important/i, '')
              .trim()
          )
        }
        rules.push({ selectors: prelude.split(',').map((s) => s.trim()), decls, order: order++ })
      }
      i = j
    }
  }
  walk(css, false)
  return rules
}

export interface Element {
  tag: string
  id: string | null
  classes: Set<string>
}

const DYNAMIC =
  /:(hover|focus|active|visited|focus-visible|focus-within|disabled|checked|before|after|placeholder|not|has|is|where|nth|first|last|only|empty|target|selection)/

/** The specificity of a selector's last compound when it matches, or null. */
function matches(selector: string, el: Element): [number, number, number] | null {
  // States, attribute scopes such as a theme, and dark themes are not the page as it first shows.
  if (DYNAMIC.test(selector) || selector.includes('[') || /\.(dark|theme-dark)\b/i.test(selector))
    return null
  const last = selector
    .split(/\s*[\s>+~]\s*/)
    .filter(Boolean)
    .pop()
  if (!last || last.includes('*')) return null
  const tag = /^[a-z][a-z0-9-]*/i.exec(last)?.[0]?.toLowerCase()
  if (tag && tag !== el.tag) return null
  const ids = [...last.matchAll(/#([\w-]+)/g)].map((m) => m[1])
  if (ids.some((id) => id !== el.id)) return null
  const classes = [...last.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) =>
    m[1]!.replace(/\\(.)/g, '$1')
  )
  if (classes.some((c) => !el.classes.has(c))) return null
  if (!tag && !ids.length && !classes.length) return null
  return [ids.length, classes.length, tag ? 1 : 0]
}

interface Hit {
  rule: Rule
  selector: string
}

/** A page's rules filed by the class, id or tag their last compound needs. */
export interface RuleIndex {
  byClass: Map<string, Hit[]>
  byId: Map<string, Hit[]>
  byTag: Map<string, Hit[]>
}

export function indexRules(rules: Rule[]): RuleIndex {
  const index: RuleIndex = { byClass: new Map(), byId: new Map(), byTag: new Map() }
  const file = (map: Map<string, Hit[]>, key: string, hit: Hit) => {
    const list = map.get(key)
    if (list) list.push(hit)
    else map.set(key, [hit])
  }
  for (const rule of rules)
    for (const selector of rule.selectors) {
      if (DYNAMIC.test(selector) || selector.includes('[')) continue
      const last = selector
        .split(/\s*[\s>+~]\s*/)
        .filter(Boolean)
        .pop()
      if (!last) continue
      const cls = /\.((?:\\.|[\w-])+)/.exec(last)?.[1]?.replace(/\\(.)/g, '$1')
      const id = /#([\w-]+)/.exec(last)?.[1]
      const tag = /^[a-z][a-z0-9-]*/i.exec(last)?.[0]?.toLowerCase()
      if (cls) file(index.byClass, cls, { rule, selector })
      else if (id) file(index.byId, id, { rule, selector })
      else if (tag) file(index.byTag, tag, { rule, selector })
    }
  return index
}

/** The declarations an inline style attribute sets. */
export function inlineStyle(attrs: string): Map<string, string> {
  const style = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
  const out = new Map<string, string>()
  for (const part of (style?.[1] ?? style?.[2] ?? '').replace(/&quot;/g, '"').split(';')) {
    const colon = part.indexOf(':')
    if (colon > 0) out.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim())
  }
  return out
}

/**
 * The declarations that win for an element, by specificity then source order,
 * with its inline style over them all.
 */
export function cascade(
  index: RuleIndex,
  el: Element,
  inline: Map<string, string> = new Map()
): Map<string, string> {
  const hits: Array<{ spec: [number, number, number]; rule: Rule }> = []
  const consider = (list: Hit[] | undefined) => {
    for (const { rule, selector } of list ?? []) {
      const spec = matches(selector, el)
      if (spec) hits.push({ spec, rule })
    }
  }
  for (const c of el.classes) consider(index.byClass.get(c))
  if (el.id) consider(index.byId.get(el.id))
  consider(index.byTag.get(el.tag))
  hits.sort(
    (a, b) =>
      a.spec[0] - b.spec[0] ||
      a.spec[1] - b.spec[1] ||
      a.spec[2] - b.spec[2] ||
      a.rule.order - b.rule.order
  )
  const out = new Map<string, string>()
  for (const { spec, rule } of hits)
    for (const [k, v] of rule.decls) {
      // A size set only by a bare tag in em is a reset's default (h1 { font-size: 2em }),
      // not the brand's: it says nothing about the headline the page shows.
      if (k === 'font-size' && spec[0] === 0 && spec[1] === 0 && /^[\d.]+em$/.test(v.trim())) {
        out.delete(k)
        continue
      }
      out.set(k, v)
    }
  for (const [k, v] of inline) out.set(k, v)
  return out
}
