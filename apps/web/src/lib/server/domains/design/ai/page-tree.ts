/**
 * A page's elements as a tree, read from its HTML without a browser: each
 * element knows its parent, how far into the page it opens and, for links and
 * buttons, its words. Scripts, styles and drawings are left out.
 */
import type { Element } from './css-cascade'

export interface PageNode extends Element {
  attrs: string
  /** The index of its parent, or -1 at the top. */
  parent: number
  /** How far into the page it opens, 0 at the top and 1 at the end. */
  at: number
  /** A link's or button's words. */
  text?: string
}

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])
const WORDED = new Set(['a', 'button'])
const LIMIT = 8000

export function pageTree(html: string): PageNode[] {
  const body = html.replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
  const nodes: PageNode[] = []
  const open: number[] = []
  const starts = new Map<number, number>()
  for (const m of body.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const tag = m[2]!.toLowerCase()
    const at = m.index ?? 0
    if (m[1]) {
      // A closing tag closes its element and any left open inside it.
      const depth = open.findLastIndex((i) => nodes[i]!.tag === tag)
      if (depth < 0) continue
      const index = open[depth]!
      if (WORDED.has(tag)) {
        const text = body
          .slice(starts.get(index)!, at)
          .slice(0, 600)
          .replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&nbsp;|&#160;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (text) nodes[index]!.text = text
      }
      open.length = depth
      continue
    }
    if (nodes.length >= LIMIT) break
    const attrs = m[3] ?? ''
    nodes.push({
      tag,
      id: /\bid\s*=\s*["']([^"']+)/i.exec(attrs)?.[1] ?? null,
      classes: new Set(
        (/\bclass\s*=\s*["']([^"']*)/i.exec(attrs)?.[1] ?? '').split(/\s+/).filter(Boolean)
      ),
      attrs,
      parent: open.at(-1) ?? -1,
      at: at / Math.max(1, body.length),
    })
    const index = nodes.length - 1
    if (WORDED.has(tag)) starts.set(index, at + m[0].length)
    if (!VOID.has(tag) && !attrs.trimEnd().endsWith('/')) open.push(index)
  }
  return nodes
}
