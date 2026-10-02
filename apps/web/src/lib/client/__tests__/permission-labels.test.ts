/**
 * Every catalogue category must have a display label — a new category that
 * lands without one would render as its raw snake_case key in the roles tab
 * and the role editor (the exact bug this replaces: ai, survey, and
 * status_page were missing from the old hand-maintained map).
 */
import { describe, it, expect } from 'vitest'
import { PERMISSION_CATEGORIES } from '@/lib/shared/permissions'
import { CATEGORY_LABELS } from '../permission-labels'

describe('CATEGORY_LABELS', () => {
  it('labels every permission category', () => {
    for (const category of PERMISSION_CATEGORIES) {
      expect(CATEGORY_LABELS[category], `missing label for '${category}'`).toBeTruthy()
      expect(CATEGORY_LABELS[category]).not.toMatch(/_/)
    }
  })

  it('has no labels for unknown categories', () => {
    const known = new Set<string>(PERMISSION_CATEGORIES)
    for (const key of Object.keys(CATEGORY_LABELS)) {
      expect(known.has(key), `stale label '${key}'`).toBe(true)
    }
  })

  it('gives every category its own label', () => {
    const labels = Object.values(CATEGORY_LABELS)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('uses the glossary words for the users and conversations groups', () => {
    expect(CATEGORY_LABELS.people).toBe('Users')
    expect(CATEGORY_LABELS.conversation).toBe('Conversations')
  })
})
