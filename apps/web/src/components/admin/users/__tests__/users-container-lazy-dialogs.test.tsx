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
  it('loads neither dialog with the page', async () => {
    await import('../users-container')
    expect(segmentFormLoaded).toBe(false)
    expect(newPersonLoaded).toBe(false)
  })
})
