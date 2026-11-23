/**
 * The product suite's own wiring: the setup project switched on every product
 * the suite covers, the admin can open each product's page without a server
 * error, and a signed-out visitor can open each public page.
 *
 * Module tests live in e2e/tests/<module>/ (status, feedback, roadmap,
 * changelog, help-center, people, platform); see README.md here.
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'

/** Collect every 5xx answer a page gets. */
function watch5xx(page: Page): string[] {
  const failures: string[] = []
  page.on('response', (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`)
  })
  return failures
}

test('the setup project turned on every product the suite covers', { tag: '@smoke' }, async () => {
  const [row] = await supportDb()`SELECT feature_flags FROM settings LIMIT 1`
  const flags = JSON.parse(String(row?.feature_flags ?? '{}')) as Record<string, unknown>
  expect(flags).toMatchObject({
    feedback: true,
    changelog: true,
    helpCenter: true,
    statusPage: true,
  })
})

test(
  'the admin opens every product page without a server error',
  { tag: '@smoke' },
  async ({ asPerson }) => {
    const admin = await asPerson('admin')
    const failures = watch5xx(admin)
    for (const [path, heading] of [
      ['/admin/feedback', /feedback/i],
      ['/admin/roadmap', /roadmap/i],
      ['/admin/changelog', /changelog/i],
      ['/admin/status', /status/i],
      ['/admin/help-center', /help center/i],
      ['/admin/users', /users|people/i],
    ] as const) {
      const res = await admin.goto(path)
      expect(res?.status(), path).toBeLessThan(400)
      await expect(admin.getByRole('heading', { name: heading }).first(), path).toBeVisible({
        timeout: 15_000,
      })
    }
    expect(failures).toEqual([])
  }
)

test('a signed-out visitor opens every public page', { tag: '@smoke' }, async ({ page }) => {
  const failures = watch5xx(page)
  for (const path of ['/', '/roadmap', '/changelog', '/status', '/hc']) {
    const res = await page.goto(path)
    expect(res?.status(), path).toBe(200)
  }
  expect(failures).toEqual([])
})
