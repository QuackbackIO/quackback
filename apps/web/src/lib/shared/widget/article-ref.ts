import { fromUuid, isValidTypeId, parseTypeId, type KbArticleId } from '@quackback/ids'

/** Public `article_` plus the stored help-center prefix. */
const ARTICLE_TYPEID_PREFIXES = new Set(['article', 'kb_article'])

/**
 * True for an article TypeID (`article_…` or `kb_article_…`).
 * Slugs and the old undocumented `art_` prefix are not.
 */
export function isArticleTypeId(ref: string): boolean {
  if (!isValidTypeId(ref)) return false
  try {
    return ARTICLE_TYPEID_PREFIXES.has(parseTypeId(ref).prefix)
  } catch {
    return false
  }
}

/**
 * Map an `article_` / `kb_article_` TypeID onto the stored `KbArticleId`.
 * Same UUID, canonical prefix — so a public `article_` id looks up the row.
 */
export function articleTypeIdToKbArticleId(ref: string): KbArticleId | null {
  try {
    const { prefix, uuid } = parseTypeId(ref)
    if (!ARTICLE_TYPEID_PREFIXES.has(prefix)) return null
    return fromUuid('kb_article', uuid)
  } catch {
    return null
  }
}
