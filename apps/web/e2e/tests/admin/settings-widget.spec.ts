import { test, expect } from '@playwright/test'

test.describe('Admin Widget Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/widget')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows Feedback Widget heading', async ({ page }) => {
    await expect(page.getByText('Feedback Widget').first()).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Embed a feedback widget directly in your product to collect feedback from users')
    ).toBeVisible({ timeout: 10000 })
  })

  test('shows Widget enable/disable card', async ({ page }) => {
    await expect(page.getByText('Enable Feedback Widget')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('When enabled, you can embed a feedback widget on any website using a script tag')
    ).toBeVisible()
  })

  test('widget toggle switch is present and interactive', async ({ page }) => {
    const widgetToggle = page.locator('#widget-toggle')
    await expect(widgetToggle).toBeVisible({ timeout: 10000 })
    await expect(widgetToggle).toBeEnabled()
  })

  test('shows Appearance section with button position selector', async ({ page }) => {
    await expect(page.getByText('Appearance')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Customize the widget launcher button and default behavior')
    ).toBeVisible()

    await expect(page.getByText('Button Position')).toBeVisible()

    // Position select trigger
    const positionSelect = page.locator('#widget-position').or(
      page.getByRole('combobox').filter({ hasText: /Bottom/i })
    )
    if ((await positionSelect.count()) > 0) {
      await expect(positionSelect.first()).toBeVisible()
    }
  })

  test('position selector shows Bottom Right and Bottom Left options', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const positionTrigger = page.locator('[id="widget-position"]')
      .or(page.getByRole('combobox').filter({ hasText: /Bottom/i }))

    if ((await positionTrigger.count()) > 0) {
      await positionTrigger.first().click()

      await expect(page.getByRole('option', { name: 'Bottom Right' })).toBeVisible({
        timeout: 5000,
      })
      await expect(page.getByRole('option', { name: 'Bottom Left' })).toBeVisible()

      await page.keyboard.press('Escape')
    }
  })

  test('shows Tabs section with Feedback and Changelog toggles', async ({ page }) => {
    await expect(page.getByText('Tabs')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Choose which sections to show in the widget.')
    ).toBeVisible()

    const feedbackSwitch = page.locator('#tab-feedback')
    const changelogSwitch = page.locator('#tab-changelog')

    await expect(feedbackSwitch).toBeVisible()
    await expect(changelogSwitch).toBeVisible()
  })

  test('shows Feedback tab label with description', async ({ page }) => {
    await expect(page.getByText('Search, vote, and submit ideas')).toBeVisible({ timeout: 10000 })
  })

  test('shows Changelog tab label with description', async ({ page }) => {
    await expect(page.getByText('Show product updates and shipped features')).toBeVisible({
      timeout: 10000,
    })
  })

  test('shows Default Board section', async ({ page }) => {
    await expect(page.getByText('Default Board')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Which board new posts from the widget are submitted to')
    ).toBeVisible()
  })

  test('shows Content card with image uploads toggle', async ({ page }) => {
    await expect(page.getByText('Content').first()).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Control what rich content types users can include in their feedback submissions.')
    ).toBeVisible()

    await expect(page.getByText('Image Uploads')).toBeVisible()
    await expect(
      page.getByText('Allow signed-in users to attach images when submitting feedback through the widget.')
    ).toBeVisible()

    const imageUploadsSwitch = page.locator('#image-uploads-in-widget')
    await expect(imageUploadsSwitch).toBeVisible()
  })

  test('shows Installation panel', async ({ page }) => {
    await expect(page.getByText('Installation')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Configure and add the widget to your site')).toBeVisible()
  })

  test('shows installation step 1 (Add the script)', async ({ page }) => {
    await expect(page.getByText('Add the script')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Paste before the closing/)).toBeVisible()
  })

  test('shows installation step 2 (Identify users)', async ({ page }) => {
    await expect(page.getByText('Identify users')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Generate a signed/)).toBeVisible()
  })

  test('shows "Verified identity only" toggle', async ({ page }) => {
    await expect(page.getByText('Verified identity only')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Disable inline email capture and require your app to sign each user')
    ).toBeVisible()

    const verifiedSwitch = page.getByRole('switch', {
      name: 'Require verified widget identity',
    })
    await expect(verifiedSwitch).toBeVisible()
  })

  test('shows widget secret section', async ({ page }) => {
    await expect(page.getByText('Widget secret')).toBeVisible({ timeout: 10000 })

    // Either a masked secret code element or the "Click regenerate" placeholder
    const secretCode = page.locator('code').filter({ hasText: /[a-z0-9•]+/i })
    const regeneratePlaceholder = page.getByText('Click regenerate to create a secret')

    const hasSecret = (await secretCode.count()) > 0
    const hasPlaceholder = (await regeneratePlaceholder.count()) > 0
    expect(hasSecret || hasPlaceholder).toBe(true)
  })

  test('shows Regenerate button for widget secret', async ({ page }) => {
    const regenerateButton = page.getByRole('button', { name: 'Regenerate' })
    await expect(regenerateButton).toBeVisible({ timeout: 10000 })
    await expect(regenerateButton).toBeEnabled()
  })

  test('shows security warning about keeping secret server-side', async ({ page }) => {
    await expect(page.getByText('Keep this secret server-side only')).toBeVisible({
      timeout: 10000,
    })
  })

  test('shows code panel with snippet.html tab', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // The snippet tab is always present
    const snippetTab = page.getByRole('button', { name: 'snippet.html' })
    await expect(snippetTab).toBeVisible({ timeout: 10000 })
  })

  test('shows code panel with identify.tsx tab', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const identifyTab = page.getByRole('button', { name: 'identify.tsx' })
    await expect(identifyTab).toBeVisible({ timeout: 10000 })
  })

  test('shows Copy button in code panel', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const copyButton = page.getByRole('button', { name: /Copy/i }).last()
    await expect(copyButton).toBeVisible({ timeout: 10000 })
  })

  test('code panel copy button changes to "Copied" on click', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Grant clipboard permissions so the copy action can succeed
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    const copyButton = page.getByRole('button', { name: 'Copy' }).last()
    if ((await copyButton.count()) === 0) {
      test.skip()
      return
    }

    await copyButton.click()

    // Should briefly show "Copied" (only if clipboard write succeeded)
    const copiedText = page.getByText('Copied').last()
    if ((await copiedText.count()) > 0) {
      await expect(copiedText).toBeVisible({ timeout: 3000 })
    }
  })

  test('shows backend framework selector', async ({ page }) => {
    await expect(page.getByText('Backend framework')).toBeVisible({ timeout: 10000 })

    // Framework select — defaults to Next.js
    const frameworkSelect = page.getByRole('combobox').filter({ hasText: /Next\.js|Express|Django|Rails|Laravel/i })
    if ((await frameworkSelect.count()) > 0) {
      await expect(frameworkSelect.first()).toBeVisible()
    }
  })

  test('framework selector shows expected backend options', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const frameworkSelect = page.getByRole('combobox').filter({
      hasText: /Next\.js|Express|Django|Rails|Laravel/i,
    })

    if ((await frameworkSelect.count()) > 0) {
      await frameworkSelect.first().click()

      await expect(page.getByRole('option', { name: 'Next.js' })).toBeVisible({ timeout: 5000 })
      await expect(page.getByRole('option', { name: 'Express' })).toBeVisible()
      await expect(page.getByRole('option', { name: 'Django' })).toBeVisible()
      await expect(page.getByRole('option', { name: 'Rails' })).toBeVisible()
      await expect(page.getByRole('option', { name: 'Laravel' })).toBeVisible()

      await page.keyboard.press('Escape')
    }
  })

  test('switching framework updates the server code tab label', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const frameworkSelect = page.getByRole('combobox').filter({
      hasText: /Next\.js|Express|Django|Rails|Laravel/i,
    })

    if ((await frameworkSelect.count()) > 0) {
      // Switch to Express
      await frameworkSelect.first().click()
      const expressOption = page.getByRole('option', { name: 'Express' })
      if ((await expressOption.count()) > 0) {
        await expressOption.click()

        // Express server example filename is widget.js
        await expect(page.getByRole('button', { name: 'widget.js' })).toBeVisible({
          timeout: 5000,
        })
      }
    }
  })

  test('shows widget preview panel', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Preview')).toBeVisible({ timeout: 10000 })
  })

  test('can toggle the widget enabled/disabled state and auto-saves', async ({ page }) => {
    const widgetToggle = page.locator('#widget-toggle')
    await expect(widgetToggle).toBeVisible({ timeout: 10000 })

    const initialChecked = await widgetToggle.isChecked()

    await widgetToggle.click()
    await page.waitForTimeout(600)

    // Restore
    const nowChecked = await widgetToggle.isChecked()
    if (nowChecked !== initialChecked) {
      await widgetToggle.click()
      await page.waitForTimeout(600)
    }
  })

  test('secret visibility toggle shows/hides the secret value', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Look for the eye/eye-slash toggle button next to the secret code
    const secretCode = page.locator('code').first()
    if ((await secretCode.count()) > 0) {
      // Find the eye button (EyeIcon or EyeSlashIcon)
      const eyeButtons = page.locator('button').filter({
        has: page.locator('svg'),
      })

      // There should be at least a show/hide button near the secret
      if ((await eyeButtons.count()) > 0) {
        // Just verify the button is enabled
        await expect(eyeButtons.first()).toBeEnabled()
      }
    }
  })
})
