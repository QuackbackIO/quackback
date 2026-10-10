// @vitest-environment happy-dom
/**
 * The users page opens on the people list with its dialogs closed. Its
 * segment and new-person forms (the segment rule builder above all) load when
 * one first opens, and a person's profile and the Companies tab load the first
 * time one is shown, not with the page.
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

let userDetailLoaded = false
vi.mock('@/components/admin/users/user-detail', () => {
  userDetailLoaded = true
  return { UserDetail: () => null }
})

let companiesViewLoaded = false
vi.mock('@/components/admin/users/companies-view', () => {
  companiesViewLoaded = true
  return { CompaniesView: () => null }
})

let companyDetailLoaded = false
vi.mock('@/components/admin/users/company-detail', () => {
  companyDetailLoaded = true
  return { CompanyDetail: () => null }
})

describe('users page', () => {
  // Importing the whole page's module graph takes seconds under a loaded suite.
  it('loads neither dialog nor a detail pane with the page', { timeout: 30_000 }, async () => {
    await import('../users-container')
    expect(segmentFormLoaded).toBe(false)
    expect(newPersonLoaded).toBe(false)
    expect(userDetailLoaded).toBe(false)
    expect(companiesViewLoaded).toBe(false)
    expect(companyDetailLoaded).toBe(false)
  })
})
