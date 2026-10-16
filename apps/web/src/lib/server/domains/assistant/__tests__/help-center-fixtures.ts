import type { RetrievedHelpCenterArticle } from '../retrieval'

/** A retrieved knowledge-base article with deterministic, id-derived fields.
 *  Shared by the synthesis and help-center-ask route tests. */
export function makeHelpCenterArticle(
  id: string,
  overrides: Partial<RetrievedHelpCenterArticle> = {}
): RetrievedHelpCenterArticle {
  const trailingDigits = id.match(/(\d+)$/)
  return {
    id,
    urlId: trailingDigits ? Number(trailingDigits[1]) : 1,
    slug: `slug-${id}`,
    title: `Title ${id}`,
    content: `Content of ${id}`,
    categoryId: 'category_1',
    categorySlug: 'general',
    categoryName: 'General',
    score: 0.9,
    isPublic: true,
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  }
}
