/**
 * Help center admin access: the permission and the product switch.
 *
 * Journeys: HC-A-01.
 */
import { test, expect } from '../../support/fixtures'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'

test(
  'HC-A-01 the admin sees the help center; a role without help_center.manage gets no access',
  { tag: '@core' },
  async ({ asPerson }) => {
    const admin = await asPerson('admin')
    await admin.goto('/admin/help-center')
    await expect(admin.getByRole('button', { name: 'New category' })).toBeVisible()
    await expect(admin.getByRole('button', { name: 'New article' }).first()).toBeVisible()
    await expect(admin.getByRole('option', { name: 'Draft', exact: true })).toBeVisible()

    const contributor = await asPerson('contributor')
    await contributor.goto('/admin/help-center')
    await expect(contributor.getByText(/You don.t have access/)).toBeVisible()
    await expect(contributor.getByRole('button', { name: 'New category' })).toBeHidden()
    await expect(contributor.getByRole('link', { name: 'Help center', exact: true })).toBeHidden()
  }
)

test(
  'HC-A-01 with the product off the help center admin page redirects elsewhere',
  { tag: ['@core', '@isolated'] },
  async ({ asPerson }) => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
    await withSettings({ feature_flags: { helpCenter: false } }, async () => {
      const admin = await asPerson('admin')
      await admin.goto('/admin/help-center')
      await expect(admin).not.toHaveURL(/\/admin\/help-center/)
      await expect(admin).toHaveURL(/\/admin\//)
      await expect(admin.getByRole('link', { name: 'Help center', exact: true })).toBeHidden()
    })
  }
)
