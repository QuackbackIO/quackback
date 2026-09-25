// @vitest-environment happy-dom
/**
 * The users page mounts its segment and new-person dialogs closed; their
 * forms (the segment rule builder above all) load when one first opens, not
 * with the page.
 */
import { describe, it, expect, vi } from 'vitest'

let segmentFormLoaded = false
vi.mock('@/components/admin/segments/segment-form', () => {
  segmentFormLoaded = true
  return { SegmentFormDialog: () => null }
})

let newPersonLoaded = false
vi.mock('@/components/admin/users/new-person-dialog', () => {
  newPersonLoaded = true
  return { NewPersonDialog: () => null }
})

describe('users page', () => {
  // Importing the whole page's module graph takes seconds under a loaded suite.
  it('loads neither dialog with the page', { timeout: 30_000 }, async () => {
    await import('../users-container')
    expect(segmentFormLoaded).toBe(false)
    expect(newPersonLoaded).toBe(false)
  })
})
