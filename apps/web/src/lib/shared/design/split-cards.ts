/**
 * Designs stored before cards split in two. One "card" look once reached
 * every card: the clickable post cards and the static panels (the filters,
 * the welcome message, a post's details). Post cards now have their own
 * look, with hover and focus, and panels theirs, at rest only. A design
 * that styled cards keeps its look: post cards take all of it, panels its
 * normal look (no lift, which only a hover has). Read on the way in, so the
 * document stored is never rewritten by a migration.
 */
import { MAX_OVERRIDES } from './style-overrides'

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** A card look's normal state as a panel's: no lift, which panels never have. */
function panelLook(look: unknown): Json | undefined {
  if (!isRecord(look) || !isRecord(look.base)) return undefined
  const { lift: _lift, ...base } = look.base
  return Object.keys(base).length ? { base } : undefined
}

/** A sheet with its card look split into post cards and panels; the same sheet when it has none. */
function splitSheet(sheet: unknown): unknown {
  if (!isRecord(sheet) || !('card' in sheet)) return sheet
  const { card, ...rest } = sheet
  const out: Json = { ...rest }
  if (isRecord(card)) {
    out.postCard ??= card
    const panel = panelLook(card)
    if (panel) out.panel ??= panel
  }
  return out
}

/** An override's layers, each as its element's look. */
const LAYERS = ['style', 'styleDark', 'phone'] as const

/** A page's card override as a post card's and a panel's; a part's (the filters) is a panel. */
function splitOverrides(list: unknown[]): unknown[] {
  const kept: unknown[] = []
  const panels: unknown[] = []
  for (const item of list) {
    const target = isRecord(item) ? item.target : undefined
    if (!isRecord(item) || !isRecord(target) || target.element !== 'card') {
      kept.push(item)
      continue
    }
    if (target.scope !== 'page') {
      kept.push({ ...item, target: { ...target, element: 'panel' } })
      continue
    }
    kept.push({ ...item, target: { ...target, element: 'postCard' } })
    const panel: Json = { id: item.id, target: { ...target, element: 'panel' } }
    for (const layer of LAYERS) {
      const look = panelLook(item[layer])
      if (look) panel[layer] = look
    }
    if (LAYERS.some((layer) => layer in panel)) panels.push(panel)
  }
  // Panels' copies go last, and only where the list has room for them.
  return [...kept, ...panels.slice(0, Math.max(0, MAX_OVERRIDES - kept.length))]
}

const hasCard = (sheet: unknown) => isRecord(sheet) && 'card' in sheet

/** Whether a design document still has a look for every card. */
function storesCards(doc: Json): boolean {
  if (hasCard(doc.style) || hasCard(doc.styleDark) || hasCard(doc.stylePhone)) return true
  if (
    Array.isArray(doc.overrides) &&
    doc.overrides.some((o) => isRecord(o) && isRecord(o.target) && o.target.element === 'card')
  )
    return true
  const blocks = isRecord(doc.pages) && isRecord(doc.pages.home) ? doc.pages.home.blocks : null
  return (
    Array.isArray(blocks) &&
    blocks.some(
      (b) => isRecord(b) && isRecord(b.look) && (hasCard(b.look.style) || hasCard(b.look.phone))
    )
  )
}

/**
 * A design document with its card looks split into post cards and panels,
 * or the same document where it has none. The document given stays as it is.
 */
export function withSplitCards(input: Json): Json {
  if (!storesCards(input)) return input
  const doc: Json = { ...input }
  for (const key of ['style', 'styleDark', 'stylePhone'])
    if (hasCard(doc[key])) doc[key] = splitSheet(doc[key])
  if (Array.isArray(doc.overrides)) doc.overrides = splitOverrides(doc.overrides)
  const pages = doc.pages
  if (isRecord(pages) && isRecord(pages.home) && Array.isArray(pages.home.blocks)) {
    const blocks = pages.home.blocks.map((block) => {
      if (!isRecord(block) || !isRecord(block.look)) return block
      const look = block.look
      if (!hasCard(look.style) && !hasCard(look.phone)) return block
      const split: Json = { ...look }
      for (const key of ['style', 'phone'])
        if (hasCard(look[key])) split[key] = splitSheet(look[key])
      return { ...block, look: split }
    })
    doc.pages = { ...pages, home: { ...pages.home, blocks } }
  }
  return doc
}
