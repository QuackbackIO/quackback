/**
 * Deleting an article or a category is a soft delete: it moves to Deleted
 * items and can be restored there for 30 days. The confirm copy says so.
 */
import { describe, expect, it } from 'vitest'
import { ARTICLE_DELETE_DESCRIPTION, categoryDeleteDescription } from '../delete-copy'

const NEVER = /permanent|cannot be undone|no restore flow|database/i

describe('delete confirm copy', () => {
  it('tells an article can be restored from Deleted items', () => {
    expect(ARTICLE_DELETE_DESCRIPTION).not.toMatch(NEVER)
    expect(ARTICLE_DELETE_DESCRIPTION).toMatch(/Deleted items/)
    expect(ARTICLE_DELETE_DESCRIPTION).toMatch(/restore/i)
    expect(ARTICLE_DELETE_DESCRIPTION).toMatch(/30 days/)
    // Deleting removes the redirect rules that point at it; a restore does not bring them back.
    expect(ARTICLE_DELETE_DESCRIPTION).toMatch(/redirects to it are removed/i)
  })

  it('tells an empty category can be restored from Deleted items', () => {
    const copy = categoryDeleteDescription('Billing', { descendantCount: 0, articleCount: 0 })
    expect(copy).not.toMatch(NEVER)
    expect(copy).toMatch(/"Billing"/)
    expect(copy).toMatch(/Deleted items/)
    expect(copy).toMatch(/30 days/)
    expect(copy).toMatch(/redirects to it are removed/i)
  })

  it('names what goes with a category and that each item can be restored', () => {
    const copy = categoryDeleteDescription('Billing', { descendantCount: 2, articleCount: 1 })
    expect(copy).not.toMatch(NEVER)
    // HC-A-36 reads this phrase.
    expect(copy).toContain('"Billing" along with 2 sub-categories and 1 article')
    expect(copy).toMatch(/Deleted items/)
    expect(copy).toMatch(/30 days/)
    // Restore is one item at a time, so one restore must not sound like it brings all back.
    expect(copy).toMatch(/restore each/i)
    expect(copy).toMatch(/redirects to them are removed/i)
    expect(copy).not.toContain('—')
  })
})
