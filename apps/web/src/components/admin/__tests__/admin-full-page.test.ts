/**
 * Full-page admin routes (the portal Customise editor) render in the admin
 * frame without the app sidebar; every other admin page keeps it.
 */
import { describe, expect, it } from 'vitest'
import { isFullPageAdminPath } from '../admin-full-page'

describe('isFullPageAdminPath', () => {
  it.each(['/admin/settings/portal/customise', '/admin/settings/portal/customise/'])(
    '%s is full page',
    (path) => expect(isFullPageAdminPath(path)).toBe(true)
  )

  it.each(['/admin', '/admin/settings/portal', '/admin/settings/portal/customised'])(
    '%s keeps the sidebar',
    (path) => expect(isFullPageAdminPath(path)).toBe(false)
  )
})
