import { ensureTypeId, isValidTypeId, type ArticleId } from '@quackback/ids'

/**
 * True for an article TypeID (`article_…` or the retired `kb_article_…` alias).
 * Slugs and the old undocumented `art_` prefix are not.
 */
export function isArticleTypeId(ref: string): boolean {
  return isValidTypeId(ref, 'article')
}

/**
 * Canonical `article_…` TypeID for a public or stored article ref.
 * Same UUID either way — so a retired `kb_article_…` id looks up the row.
 */
export function canonicalArticleTypeId(ref: string): ArticleId | null {
  if (!isValidTypeId(ref, 'article')) return null
  return ensureTypeId(ref, 'article')
}
