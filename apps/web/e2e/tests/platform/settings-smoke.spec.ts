/**
 * The settings pages this area owns open for their owner role without an
 * error, and the old Branding address lands on Portal.
 *
 * Journeys: INT-ST-25, INT-ST-04, INT-ST-01 (refusals only).
 *
 * INT-ST-01's save is left out: the workspace name shows on every portal page
 * and in every email other tests read.
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { callServerFn } from '../../support/server-fns'
import { asPersonApi } from '../../product/platform-admin'

/** Collect every 5xx answer a page gets. */
function watch5xx(page: Page): string[] {
  const failures: string[] = []
  page.on('response', (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`)
  })
  return failures
}

test(
  'INT-ST-25 every settings page of this area opens without an error',
  { tag: '@smoke' },
  async ({ asPerson }) => {
    const admin = await asPerson('admin')
    const failures = watch5xx(admin)
    const pageErrors: string[] = []
    admin.on('pageerror', (e) => pageErrors.push(e.message))
    for (const [path, heading] of [
      ['/admin/settings/general', /general/i],
      ['/admin/settings/portal', /portal/i],
      ['/admin/settings/domains', /domains/i],
      ['/admin/settings/email', /email/i],
      ['/admin/settings/labs', /labs/i],
      ['/admin/settings/notifications', /notifications/i],
      ['/admin/settings/integrations', /integrations/i],
      ['/admin/settings/billing/limits', /plan limits/i],
    ] as const) {
      const res = await admin.goto(path)
      expect(res?.status(), path).toBeLessThan(400)
      await expect(admin, path).toHaveURL(new RegExp(`${path}(\\?|$)`))
      await expect(admin.getByRole('heading', { level: 1, name: heading }), path).toBeVisible({
        timeout: 15_000,
      })
    }
    expect(failures).toEqual([])
    expect(pageErrors).toEqual([])
  }
)

test(
  'INT-ST-04 the old Branding address opens Portal settings',
  { tag: '@core' },
  async ({ asPerson }) => {
    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/branding')
    await expect(admin).toHaveURL(/\/admin\/settings\/portal(\?|$)/)
    await expect(admin.getByRole('heading', { name: /portal/i }).first()).toBeVisible()
  }
)

test(
  'INT-ST-01 the workspace name refuses an empty or too long name, and a Contributor',
  { tag: '@core' },
  async ({ playwright }) => {
    const { supportDb } = await import('../../support/db')
    const [before] = await supportDb()<{ name: string }[]>`SELECT name FROM settings LIMIT 1`
    await asPersonApi(playwright, 'admin', async (api) => {
      const empty = await callServerFn(api, 'updateWorkspaceNameFn', { name: '' })
      expect(empty.ok).toBe(false)
      expect(empty.error).toContain('Name is required')
      const long = await callServerFn(api, 'updateWorkspaceNameFn', { name: 'x'.repeat(101) })
      expect(long.ok).toBe(false)
      expect(long.error).toContain('Name too long')
    })
    await asPersonApi(playwright, 'contributor', async (api) => {
      const refused = await callServerFn(api, 'updateWorkspaceNameFn', { name: 'Taken over' })
      expect(refused.ok).toBe(false)
      expect(refused.error).toContain('Access denied')
    })
    const [after] = await supportDb()<{ name: string }[]>`SELECT name FROM settings LIMIT 1`
    expect(after.name).toBe(before.name)
  }
)
