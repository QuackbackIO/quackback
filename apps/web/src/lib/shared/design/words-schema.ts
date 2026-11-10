/**
 * The one schema of each kind of words: built from the words editor's own
 * extensions, so what the editor holds, what the design stores and what the
 * AI may write are the same thing. Words that enter the design are checked
 * against it; words that fail are fitted to their kind and then pass.
 *
 * Environment-free: the editor's extensions describe the schema without a
 * view, so the server checks words with it too. It pulls in no React and no
 * DOM, and nothing the portal's read surfaces load imports it.
 */
import { getSchema } from '@tiptap/core'
import { Node as PMNode, type Schema } from '@tiptap/pm/model'
import { wordsExtensions } from '@/lib/shared/words-editor/extensions'
import {
  docText,
  fitDoc,
  isWordsDoc,
  plainDoc,
  RICH_HEADINGS,
  type WordsDoc,
  type WordsKind,
  type WordsNode,
} from './rich-words'

/** Each kind's schema, built once from the editor's own extensions. */
const SCHEMAS: Readonly<Record<WordsKind, Schema>> = {
  headline: getSchema(wordsExtensions({ kind: 'headline' })),
  plain: getSchema(wordsExtensions({ kind: 'plain' })),
  rich: getSchema(wordsExtensions({ kind: 'rich' })),
}

/** The schema of one kind of words, from the editor's own extensions. */
export const wordsSchema = (kind: WordsKind): Schema => SCHEMAS[kind]

/** Why words do not fit their kind's schema, or null when they do. No words at all always fit. */
export function wordsProblem(doc: unknown, kind: WordsKind): string | null {
  if (!isWordsDoc(doc)) return 'Words are a document'
  if (!doc.content?.length) return null
  try {
    PMNode.fromJSON(wordsSchema(kind), doc).check()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Whether words fit their kind's schema. */
export const isValidWords = (doc: unknown, kind: WordsKind): doc is WordsDoc =>
  wordsProblem(doc, kind) === null

/**
 * Words as they enter the design: fitted to their kind (the design's own
 * rules: one phrase set apart, its length, the limit, safe links), and then
 * held by the schema. Should fitting ever leave words the schema refuses,
 * their text alone is kept, so an invalid document is never stored.
 */
export function checkedWords(doc: unknown, kind: WordsKind, limit?: number | null): WordsDoc {
  const fitted = fitDoc(isWordsDoc(doc) ? doc : null, kind, limit)
  if (isValidWords(fitted, kind)) return fitted
  const text = docText(fitted)
  return kind === 'rich' && !text ? { type: 'doc', content: [] } : plainDoc(text)
}

/**
 * Whether rich words hold more than the words editor can: a node or mark the
 * rich schema has no place for, or a heading of another level. Such words,
 * written with the full editor (images, tables, other headings), are left
 * as they are and edited in the panel.
 */
export function holdsMoreThanWords(doc: unknown): boolean {
  if (!isWordsDoc(doc)) return false
  const { nodes, marks } = wordsSchema('rich')
  const more = (node: WordsNode): boolean =>
    !(node.type in nodes) ||
    (node.type === 'heading' &&
      !(RICH_HEADINGS as readonly unknown[]).includes(node.attrs?.level)) ||
    (node.marks ?? []).some((mark) => !(mark.type in marks)) ||
    (node.content ?? []).some(more)
  return (doc.content ?? []).some(more)
}
