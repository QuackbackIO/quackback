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
      page.getByText('Anonymous access and approval rules for incoming posts.')
    ).toBeVisible({ timeout: 10000 })
  })

  test('shows Anonymous access card with the master switch', async ({ page }) => {
    // Card title is an <h2>; match by heading role so it doesn't collide with the
    // page description ("Anonymous access and approval rules for incoming posts.").
    await expect(page.getByRole('heading', { name: 'Anonymous access' })).toBeVisible({
      timeout: 10000,
    })
    // Consolidated single master switch (replaces the old 3 per-action toggles).
    await expect(page.getByRole('switch', { name: 'Allow anonymous interaction' })).toBeVisible()
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

  test('page shows the anonymous-access and approval-rules cards', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Anonymous access' })).toBeVisible({
      timeout: 10000,
    })
    await expect(page.getByRole('heading', { name: 'Approval rules' })).toBeVisible()
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
