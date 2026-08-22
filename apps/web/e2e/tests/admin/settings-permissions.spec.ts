import { test, expect } from '@playwright/test'

/**
 * Admin → Settings → Moderation.
 *
 * Post-PR #191 the legacy per-action anonymous toggles (#anon-posting /
 * #anon-commenting / #anon-voting) were consolidated into a single
 * `Allow anonymous interaction` master switch (features.allowAnonymous), and
 * the per-axis approval rules became tri-state-resolving switches.
 */
test.describe('Admin Moderation Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/moderation')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows moderation heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Moderation' })).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Approval rules and content review for incoming posts and comments.')
    ).toBeVisible({ timeout: 10000 })
  })

  test('does not show the anonymous-access card (moved to Portal access)', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Anonymous access' })).toHaveCount(0)
    await expect(page.getByRole('switch', { name: 'Allow anonymous interaction' })).toHaveCount(0)
  })

  test('shows Approval rules card with per-axis approval switches', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Approval rules' })).toBeVisible({
      timeout: 10000,
    })
    await expect(
      page.getByRole('switch', { name: 'Require approval for anonymous posts' })
    ).toBeVisible()
    await expect(
      page.getByRole('switch', { name: 'Require approval for signed-in posts' })
    ).toBeVisible()
  })

  test('page shows the approval-rules and content-review cards', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Approval rules' })).toBeVisible({
      timeout: 10000,
    })
    await expect(page.getByRole('heading', { name: 'Content review' })).toBeVisible()
  })
})

test.describe('Admin Portal access — anonymous interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/security/authentication?tab=portal-access')
    await page.waitForLoadState('networkidle')
  })

  test('shows the allow-anonymous master switch', async ({ page }) => {
    await expect(page.getByRole('switch', { name: 'Allow anonymous interaction' })).toBeVisible({
      timeout: 10000,
    })
  })

  test('the allow-anonymous master switch is interactive', async ({ page }) => {
    const toggle = page.getByRole('switch', { name: 'Allow anonymous interaction' })
    await expect(toggle).toBeVisible({ timeout: 10000 })
    await expect(toggle).toBeEnabled()
  })

  test('toggling the master switch auto-saves and persists', async ({ page }) => {
    const toggle = page.getByRole('switch', { name: 'Allow anonymous interaction' })
    await expect(toggle).toBeVisible({ timeout: 10000 })

    const initial = await toggle.getAttribute('aria-checked')
    await toggle.click()
    await page.waitForTimeout(500) // auto-saves on change

    // Reload and confirm the new value persisted, then restore the original.
    await page.reload()
    await page.waitForLoadState('networkidle')
    const persisted = await toggle.getAttribute('aria-checked')
    expect(persisted).not.toBe(initial)

    await toggle.click()
    await page.waitForTimeout(500)
    await page.reload()
    await page.waitForLoadState('networkidle')
    expect(await toggle.getAttribute('aria-checked')).toBe(initial)
  })
})
