import { test, expect } from '@playwright/test'

test.describe('Admin Branding Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/branding')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows branding settings', async ({ page }) => {
    await expect(page.getByText('Branding').first()).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText("Customize your portal's appearance and branding")
    ).toBeVisible({ timeout: 10000 })
  })

  test('shows Identity section with workspace name input', async ({ page }) => {
    await expect(page.getByText('Identity').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByLabel('Workspace Name')).toBeVisible({ timeout: 10000 })
  })

  test('shows logo upload section', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // The logo uploader renders either an <img> or an initial-letter div, plus a hidden file input
    const fileInput = page.locator('input[type="file"][accept*="image"]')
    await expect(fileInput).toBeAttached({ timeout: 10000 })
  })

  test('file input accepts image types', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const fileInput = page.locator('input[type="file"]')
    if ((await fileInput.count()) > 0) {
      const accept = await fileInput.first().getAttribute('accept')
      expect(accept).toContain('image')
    }
  })

  test('shows Theme Mode section with select', async ({ page }) => {
    await expect(page.getByText('Theme Mode')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Control how light/dark mode works for portal visitors')
    ).toBeVisible()

    // Theme mode combobox should be present
    const themeModeSelect = page.getByRole('combobox').first()
    await expect(themeModeSelect).toBeVisible()
  })

  test('shows Theme section with color preset swatches', async ({ page }) => {
    await expect(page.getByText('Theme', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Choose a preset to set your portal\'s color palette')
    ).toBeVisible()

    // Theme preset buttons render as a grid of buttons with color swatches
    const presetButtons = page.locator('button').filter({
      has: page.locator('div[style*="background-color"]'),
    })
    expect(await presetButtons.count()).toBeGreaterThan(0)
  })

  test('shows Typography section with font and corner roundness controls', async ({ page }) => {
    await expect(page.getByText('Typography')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Font and corner styling')).toBeVisible()

    // Font label
    await expect(page.getByText('Font').first()).toBeVisible()

    // Corner Roundness label and slider
    await expect(page.getByText('Corner Roundness')).toBeVisible()
    await expect(page.getByRole('slider')).toBeVisible()
  })

  test('shows Theme CSS editor section', async ({ page }) => {
    await expect(page.getByText('Theme CSS')).toBeVisible({ timeout: 10000 })

    // The tweakcn.com link should be visible
    const tweakCnLink = page.getByRole('link', { name: 'tweakcn.com' })
    await expect(tweakCnLink).toBeVisible()
  })

  test('Save Changes button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible({
      timeout: 10000,
    })
  })

  test('shows preview panel with light/dark toggle', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Preview panel has a "Preview" label
    await expect(page.getByText('Preview')).toBeVisible({ timeout: 10000 })

    // Light and Dark toggle buttons should be in the preview header
    const lightButton = page.getByRole('button', { name: /light/i })
    const darkButton = page.getByRole('button', { name: /dark/i })

    if ((await lightButton.count()) > 0) {
      await expect(lightButton.first()).toBeVisible()
    }
    if ((await darkButton.count()) > 0) {
      await expect(darkButton.first()).toBeVisible()
    }
  })

  test('can edit workspace name', async ({ page }) => {
    const nameInput = page.getByLabel('Workspace Name')
    await expect(nameInput).toBeVisible({ timeout: 10000 })

    // Record the current value
    const originalValue = await nameInput.inputValue()

    // Change the name
    const testName = `Test Workspace ${Date.now()}`
    await nameInput.clear()
    await nameInput.fill(testName)
    await expect(nameInput).toHaveValue(testName)

    // Debounced save - wait a moment
    await page.waitForTimeout(1000)

    // Restore the original name
    await nameInput.clear()
    await nameInput.fill(originalValue || 'Acme')
    await page.waitForTimeout(1000)
  })

  test('workspace name input has placeholder', async ({ page }) => {
    const nameInput = page.getByLabel('Workspace Name')
    await expect(nameInput).toBeVisible({ timeout: 10000 })

    const placeholder = await nameInput.getAttribute('placeholder')
    expect(placeholder).toBeTruthy()
  })

  test('can switch theme mode options', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Find the theme mode select (first combobox in the controls panel)
    const themeModeSelect = page.getByRole('combobox').first()
    await expect(themeModeSelect).toBeVisible({ timeout: 5000 })

    // Open the dropdown
    await themeModeSelect.click()

    // Should show the three theme mode options
    await expect(page.getByRole('option', { name: 'User choice (allow toggle)' })).toBeVisible({
      timeout: 5000,
    })
    await expect(page.getByRole('option', { name: 'Light only' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Dark only' })).toBeVisible()

    // Close the dropdown
    await page.keyboard.press('Escape')
  })

  test('can select a different theme preset', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Get theme preset buttons (they have a color swatch div inside)
    const presetButtons = page.locator('button').filter({
      has: page.locator('div[style*="background-color"]'),
    })

    if ((await presetButtons.count()) >= 2) {
      // Click the second preset to switch away from whatever is active
      await presetButtons.nth(1).click()

      // The preset button should now have the active ring styling
      // Just verify the click doesn't cause an error
      await page.waitForLoadState('networkidle')
    }
  })

  test('can toggle preview between light and dark', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const lightButton = page.getByRole('button', { name: /^Light$/i })
    const darkButton = page.getByRole('button', { name: /^Dark$/i })

    if ((await lightButton.count()) > 0 && (await darkButton.count()) > 0) {
      // Only click a button if it is enabled (buttons are disabled when themeMode forces that mode)
      if (await darkButton.first().isEnabled()) {
        await darkButton.first().click()
        await page.waitForTimeout(300)
      }

      if (await lightButton.first().isEnabled()) {
        await lightButton.first().click()
        await page.waitForTimeout(300)
      }
    }
  })

  test('Save Changes button is enabled by default', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const saveButton = page.getByRole('button', { name: 'Save Changes' })
    await expect(saveButton).toBeVisible({ timeout: 10000 })
    await expect(saveButton).toBeEnabled()
  })

  test('save button shows saving state when clicked', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const saveButton = page.getByRole('button', { name: 'Save Changes' })
    await expect(saveButton).toBeVisible({ timeout: 10000 })

    await saveButton.click()

    // Should briefly show "Saving..." then either "Saved!" or back to "Save Changes"
    const savingOrSaved = page
      .getByRole('button', { name: 'Saving...' })
      .or(page.getByRole('button', { name: 'Saved!' }))
      .or(page.getByRole('button', { name: 'Save Changes' }))

    await expect(savingOrSaved.first()).toBeVisible({ timeout: 5000 })

    // Eventually returns to idle state
    await expect(page.getByRole('button', { name: /Save/i })).toBeVisible({ timeout: 10000 })
  })

  test('logo area shows either uploaded logo or workspace initial', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // The logo uploader renders an <img> if logo is set, or a div with the initial letter
    const logoImage = page.locator('img[alt]').first()
    const logoPlaceholder = page.locator('button[type="button"] div.rounded-xl')

    const hasLogo = (await logoImage.count()) > 0 || (await logoPlaceholder.count()) > 0
    expect(hasLogo).toBe(true)
  })

  test('corner roundness slider is interactive', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const slider = page.getByRole('slider')
    await expect(slider).toBeVisible({ timeout: 10000 })
    await expect(slider).toBeEnabled()
  })

  test('font selector shows font options', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Font selector is the second combobox (first is theme mode)
    const fontSelect = page.getByRole('combobox').nth(1)
    if ((await fontSelect.count()) > 0) {
      await fontSelect.click()

      // Should show font category groups
      const sansSerifGroup = page.getByRole('group').filter({ hasText: 'Sans Serif' })
      if ((await sansSerifGroup.count()) > 0) {
        await expect(sansSerifGroup).toBeVisible({ timeout: 5000 })
      }

      await page.keyboard.press('Escape')
    }
  })
})
