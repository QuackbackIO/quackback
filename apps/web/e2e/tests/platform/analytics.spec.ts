/**
 * The Analytics page: who may open it and read its data, and the section in
 * the URL.
 *
 * Journeys: INT-AN-01, INT-AN-02.
 */
import { test, expect } from '../../support/fixtures'
import { callServerFn } from '../../support/server-fns'
import { asPersonApi } from '../../product/platform-admin'

test(
  'INT-AN-01 analytics opens for analytics.view; a teammate without it is refused',
  { tag: '@core' },
  async ({ asPerson, playwright }) => {
    const admin = await asPerson('admin')
    await admin.goto('/admin/analytics')
    await expect(admin.getByRole('heading', { level: 2, name: 'Analytics' })).toBeVisible({
      timeout: 15_000,
    })
    await asPersonApi(playwright, 'admin', async (api) => {
      for (const name of ['getAnalyticsData', 'getVisitorAnalyticsData']) {
        const res = await callServerFn(api, name, { period: '30d' }, { method: 'GET' })
        expect(res.ok, `${name}: ${res.error}`).toBe(true)
      }
    })

    // A teammate whose role has no analytics.view: both reads refused.
    await asPersonApi(playwright, 'noAccess', async (api) => {
      for (const name of ['getAnalyticsData', 'getVisitorAnalyticsData']) {
        const res = await callServerFn(api, name, { period: '30d' }, { method: 'GET' })
        expect(res.ok, name).toBe(false)
        expect(res.error, name).toContain("Requires permission 'analytics.view'")
      }
    })
    const member = await asPerson('noAccess')
    await member.goto('/admin/analytics')
    await member.waitForLoadState('networkidle')
    await expect(member.getByRole('heading', { level: 2, name: 'Analytics' })).toHaveCount(0)
  }
)

test(
  'INT-AN-02 the open section lives in the URL; an unknown section opens the overview',
  { tag: '@core' },
  async ({ asPerson }) => {
    const admin = await asPerson('admin')
    const section = (name: string) =>
      admin.locator('[data-side-pane]').getByRole('button', { name, exact: true })
    await admin.goto('/admin/analytics?section=feedback')
    await expect(admin).toHaveURL(/section=feedback/)
    await expect(section('Feedback')).toHaveAttribute('data-active', 'true', { timeout: 15_000 })
    await expect(section('Overview')).not.toHaveAttribute('data-active', 'true')

    // Picking a section puts it in the URL.
    await section('Changelog').click()
    await expect(admin).toHaveURL(/section=changelog/)
    await expect(section('Changelog')).toHaveAttribute('data-active', 'true')

    await admin.goto('/admin/analytics?section=nonsense')
    await expect(section('Overview')).toHaveAttribute('data-active', 'true', { timeout: 15_000 })
    await expect(section('Feedback')).not.toHaveAttribute('data-active', 'true')
  }
)
