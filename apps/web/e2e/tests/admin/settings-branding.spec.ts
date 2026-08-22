import { test, expect } from '@playwright/test'

test.describe('Admin Portal Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/portal')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows portal settings', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Portal' })).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Everything visitors see on your portal — theme, navigation, and content')
    ).toBeVisible({ timeout: 10000 })
  })

  test('/admin/settings/branding redirects to portal', async ({ page }) => {
    await page.goto('/admin/settings/branding')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/admin\/settings\/portal/)
    await expect(page.getByRole('heading', { name: 'Portal' })).toBeVisible({ timeout: 10000 })
  })

  test('shows Appearance, Navigation, and Welcome message cards', async ({ page }) => {
    await expect(page.getByText('Appearance').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Navigation').first()).toBeVisible()
    await expect(page.getByText('Welcome message').first()).toBeVisible()
  })

  test('shows Theme mode select', async ({ page }) => {
    await expect(page.getByText('Theme mode')).toBeVisible({ timeout: 10000 })
    const themeModeSelect = page.getByRole('combobox').first()
    await expect(themeModeSelect).toBeVisible()
  })

  test('shows theme preset swatches', async ({ page }) => {
    const presetButtons = page.locator('button').filter({
      has: page.locator('div[style*="background-color"]'),
    })
    expect(await presetButtons.count()).toBeGreaterThan(0)
  })

  test('shows font and corner roundness controls', async ({ page }) => {
    await expect(page.getByText('Font').first()).toBeVisible()
    await expect(page.getByText('Corner Roundness')).toBeVisible()
    await expect(page.getByRole('slider')).toBeVisible()
  })

  test('shows Advanced CSS panel with tweakcn link', async ({ page }) => {
    await expect(page.getByText('Advanced CSS')).toBeVisible({ timeout: 10000 })
    const tweakCnLink = page.getByRole('link', { name: 'tweakcn.com' })
    await expect(tweakCnLink).toBeVisible()
  })

  test('shows live preview with light/dark toggle', async ({ page }) => {
    await expect(page.getByText('Live preview')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /^Light$/i }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /^Dark$/i }).first()).toBeVisible()
  })

  test('can switch theme mode options', async ({ page }) => {
    const themeModeSelect = page.getByRole('combobox').first()
    await expect(themeModeSelect).toBeVisible({ timeout: 5000 })
    await themeModeSelect.click()
    await expect(page.getByRole('option', { name: 'User choice (allow toggle)' })).toBeVisible({
      timeout: 5000,
    })
    await expect(page.getByRole('option', { name: 'Light only' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Dark only' })).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('Feedback nav row is always on', async ({ page }) => {
    await expect(page.getByText('Always on').first()).toBeVisible({ timeout: 10000 })
  })

  test('corner roundness slider is interactive', async ({ page }) => {
    const slider = page.getByRole('slider')
    await expect(slider).toBeVisible({ timeout: 10000 })
    await expect(slider).toBeEnabled()
  })
})
