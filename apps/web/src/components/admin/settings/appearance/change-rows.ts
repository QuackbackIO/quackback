/**
 * Show changes under an Ask AI reply, as rows in words. A request's changes
 * come per field, each carrying the labels of the operations that made it;
 * one operation can touch several fields (a hero look sets its fill and its
 * art), so rows are made per operation, said as the operation is, never a
 * field per row named after the operation. Changes no operation names (a
 * brand match's) read field by field, as "Thing: old → new". A swatch shows
 * only beside an actual colour, never beside a role or a relative value.
 */
import type { AppliedDesignChange } from '@/lib/shared/design/apply-changes'
import { colourName } from '@/lib/shared/design/colour-names'
import { changeLabel, styleValueWords } from '@/lib/shared/design/labels'
import { STYLE_PROPS, type StyleProp } from '@/lib/shared/design/style-tokens'
import { shownValue, valueWords } from './change-list'

/** One side of a row: its words, and the colour itself where it is one. */
export interface RowSide {
  words: string
  swatch?: string
}

/** What a row changed, as the canvas finds where it shows. */
export interface RowChange {
  path: string
  before: unknown
  after: unknown
}

export type ChangeRow =
  /** A field changed, "Thing: old → new". */
  | { key: string; path: string; at: RowChange; label: string; before: RowSide; after: RowSide }
  /** An operation, said as it was done: "Hero look: Brand colour with waves". */
  | { key: string; path: string; at: RowChange; text: string; swatch?: string }

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const STYLE_PATH = /^(?:style|styleDark)\.\w+\.\w+\.(\w+)$/

/** A colour a swatch can draw: a hex, or a colour function a name can be read from. */
function actualColour(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return value
  if (/^oklch\(/i.test(value) && colourName(value) !== 'colour') return value
  return null
}

/** A value written as a colour the design works out, such as one made from another. */
const relativeColour = (value: unknown) =>
  typeof value === 'string' && /^(?:oklch|color-mix|rgb|hsl|var)\(/i.test(value)

/** One side of a field's change, in words, with a swatch only for an actual colour. */
export function sideOf(path: string, raw: unknown): RowSide {
  const value = shownValue(path, raw)
  const colour = actualColour(value)
  if (colour) return { words: capital(colourName(colour)), swatch: colour }
  if (relativeColour(value)) return { words: 'Worked out from the brand' }
  const prop = STYLE_PATH.exec(path)?.[1]
  if (prop && Object.hasOwn(STYLE_PROPS, prop) && value != null)
    return { words: capital(styleValueWords(prop as StyleProp, value)) }
  return { words: valueWords(value) }
}

/** What a side reads as, to leave out a row whose two sides read the same. */
const readAs = (side: RowSide) => side.words

/**
 * A value a person cannot read as a change: a list or object that would only
 * say "Changed", or an exact size the builder set (sizes show on the page).
 */
const technical = (value: unknown) =>
  (!!value && typeof value === 'object') ||
  (typeof value === 'string' && /^-?[\d.]+ (px|em)$/.test(value))

type Leaf = { path: string; label: string; before: unknown; after: unknown }

/** The fields a change holds that read as a change: one for a plain value, one per value in an object. */
function leavesOf(path: string, before: unknown, after: unknown, depth = 0): Leaf[] {
  const was = shownValue(path, before)
  const now = shownValue(path, after)
  const nested = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)
  if (depth < 4 && (nested(was) || nested(now))) {
    const keys = new Set([
      ...Object.keys(nested(before) ? (before as object) : {}),
      ...Object.keys(nested(after) ? (after as object) : {}),
    ])
    const at = (v: unknown, key: string) =>
      nested(v) ? (v as Record<string, unknown>)[key] : undefined
    return [...keys].flatMap((key) =>
      leavesOf(`${path}.${key}`, at(before, key), at(after, key), depth + 1)
    )
  }
  if ([was, now].some(technical)) return []
  if (readAs(sideOf(path, before)) === readAs(sideOf(path, after))) return []
  return [{ path, label: changeLabel(path).replace(': ', ' '), before, after }]
}

/** Words compared loosely: case, punctuation and joining words aside. */
const loose = (text: string) =>
  ` ${text
    .toLowerCase()
    .replace(/[,:;()]/g, ' ')
    .replace(/\b(on|when|to)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `

/**
 * Whether an operation's label is about this field: it starts with the
 * field's name, or for a style, with its property as the operation names it.
 */
function about(op: string, leaf: Leaf): boolean {
  const prop = STYLE_PATH.exec(leaf.path)?.[1]
  const names = [leaf.label]
  if (prop && Object.hasOwn(STYLE_PROPS, prop))
    names.push(
      leaf.label.replace(new RegExp(`${STYLE_PROPS[prop as StyleProp].label}$`, 'i'), prop)
    )
  return names.some((name) => loose(op).startsWith(loose(name)))
}

/**
 * An operation's label in plain words: no codes in brackets, a colour by its
 * name, a style's property by the name its panel gives it.
 */
function opWords(op: string, leaf: Leaf | null): string {
  let text = op.replace(/\s*\([^)]*#[0-9a-f]{3,6}[^)]*\)/gi, '')
  const prop = leaf ? STYLE_PATH.exec(leaf.path)?.[1] : undefined
  if (prop && Object.hasOwn(STYLE_PROPS, prop))
    text = text.replace(
      `: ${prop} `,
      `: ${STYLE_PROPS[prop as StyleProp].label.toLowerCase()} `
    )
  text = text.replace(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi, (hex) => colourName(hex))
  return capital(text.trim())
}

/**
 * The rows for a request's changes: one per operation, in the order they
 * were made, and for changes no operation names, one per field.
 */
export function changeRows(changes: readonly AppliedDesignChange[]): ChangeRow[] {
  const rows: ChangeRow[] = []
  const said = new Set<string>()
  for (const change of changes) {
    const leaves = leavesOf(change.path, change.before, change.after)
    const named = (change.label ?? '')
      .split('; ')
      .map((op) => op.trim())
      .filter(Boolean)
    if (!named.length) {
      for (const leaf of leaves)
        rows.push({
          key: leaf.path,
          path: leaf.path,
          at: { path: leaf.path, before: leaf.before, after: leaf.after },
          label: leaf.label,
          before: sideOf(leaf.path, leaf.before),
          after: sideOf(leaf.path, leaf.after),
        })
      continue
    }
    // A field another operation already said is part of what that operation did.
    const ops = named.filter((op) => !said.has(op))
    const claimed = new Set<Leaf>()
    for (const op of ops) {
      said.add(op)
      const free = leaves.filter((leaf) => !claimed.has(leaf))
      const leaf =
        free.find((each) => about(op, each)) ??
        (named.length === 1 && leaves.length === 1 ? leaves[0]! : null)
      if (leaf) claimed.add(leaf)
      const swatch = leaf ? sideOf(leaf.path, leaf.after).swatch : undefined
      rows.push({
        key: `${change.path}|${op}`,
        path: leaf?.path ?? change.path,
        // A field the operation is about, else everything its change did.
        at: leaf
          ? { path: leaf.path, before: leaf.before, after: leaf.after }
          : { path: change.path, before: change.before, after: change.after },
        text: opWords(op, leaf),
        ...(swatch ? { swatch } : {}),
      })
    }
  }
  return rows
}
