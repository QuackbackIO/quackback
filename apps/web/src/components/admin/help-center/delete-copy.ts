/**
 * Confirm copy for deleting help center content. A delete is soft: the item
 * moves to Deleted items and can be restored there for 30 days.
 */

export const ARTICLE_DELETE_DESCRIPTION =
  'The article moves to Deleted items. You can restore it from there for 30 days.'

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function categoryDeleteDescription(
  name: string,
  impact: { descendantCount: number; articleCount: number }
): string {
  const parts: string[] = []
  if (impact.descendantCount > 0) {
    parts.push(count(impact.descendantCount, 'sub-category', 'sub-categories'))
  }
  if (impact.articleCount > 0) {
    parts.push(count(impact.articleCount, 'article', 'articles'))
  }
  if (parts.length === 0) {
    return `"${name}" moves to Deleted items. You can restore it from there for 30 days.`
  }
  return `"${name}" and its ${parts.join(' and ')} move to Deleted items. You can restore them from there for 30 days.`
}
