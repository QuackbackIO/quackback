import type { RetrievedKbArticle } from '../retrieval'

/** A retrieved knowledge-base article with deterministic, id-derived fields.
 *  Shared by the synthesis and kb-ask route tests. */
export function makeKbArticle(
  id: string,
  overrides: Partial<RetrievedKbArticle> = {}
): RetrievedKbArticle {
  return {
    id,
    slug: `slug-${id}`,
    title: `Title ${id}`,
    content: `Content of ${id}`,
    categoryId: 'kb_category_1',
    categorySlug: 'general',
    categoryName: 'General',
    score: 0.9,
    isPublic: true,
    ...overrides,
  }
}
