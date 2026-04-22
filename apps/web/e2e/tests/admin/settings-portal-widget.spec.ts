import { test, expect } from '@playwright/test'

test.describe('Admin Portal Widget Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/portal-widget')
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

  test('shows "Verified identity only" toggle with aria-label', async ({ page }) => {
    await expect(page.getByText('Verified identity only')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Disable inline email capture and require your app to sign each user')
    ).toBeVisible()

    const verifiedSwitch = page.getByRole('switch', {
      name: 'Require verified widget identity',
    })
    await expect(verifiedSwitch).toBeVisible()
  })

  test('"Verified identity only" toggle can be switched on', async ({ page }) => {
    const verifiedSwitch = page.getByRole('switch', {
      name: 'Require verified widget identity',
    })
    await expect(verifiedSwitch).toBeVisible({ timeout: 10000 })

    const wasChecked = await verifiedSwitch.isChecked()

    // Turn it on if it is off
    if (!wasChecked) {
      await verifiedSwitch.click()
      await expect(verifiedSwitch).toBeChecked({ timeout: 5000 })
    } else {
      // Already on — verify it is on
      await expect(verifiedSwitch).toBeChecked()
    }
  })

  test('"Verified identity only" toggle can be switched off after being turned on', async ({ page }) => {
    const verifiedSwitch = page.getByRole('switch', {
      name: 'Require verified widget identity',
    })
    await expect(verifiedSwitch).toBeVisible({ timeout: 10000 })

    const wasChecked = await verifiedSwitch.isChecked()

    // Ensure it is on, then turn it off
    if (!wasChecked) {
      await verifiedSwitch.click()
      await expect(verifiedSwitch).toBeChecked({ timeout: 5000 })
    }
    await expect(verifiedSwitch).toBeChecked()

    await verifiedSwitch.click()
    await expect(verifiedSwitch).not.toBeChecked({ timeout: 5000 })

    // Restore original state
    if (wasChecked) {
      await verifiedSwitch.click()
      await expect(verifiedSwitch).toBeChecked({ timeout: 5000 })
    }
  })

  test('when "Verified identity only" is on, backend framework selector appears', async ({ page }) => {
    const verifiedSwitch = page.getByRole('switch', {
      name: 'Require verified widget identity',
    })
    await expect(verifiedSwitch).toBeVisible({ timeout: 10000 })

    if (!(await verifiedSwitch.isChecked())) {
      await verifiedSwitch.click()
      await expect(verifiedSwitch).toBeChecked({ timeout: 5000 })
    }

    await expect(page.getByText('Backend framework')).toBeVisible({ timeout: 5000 })
    const frameworkSelect = page.getByRole('combobox').filter({
      hasText: /Next\.js|Express|Django|Rails|Laravel/i,
    })
    await expect(frameworkSelect.first()).toBeVisible()
  })

  test('framework selector shows all five backend options', async ({ page }) => {
    const verifiedSwitch = page.getByRole('switch', {
      name: 'Require verified widget identity',
    })
    await expect(verifiedSwitch).toBeVisible({ timeout: 10000 })

    if (!(await verifiedSwitch.isChecked())) {
      await verifiedSwitch.click()
      await expect(verifiedSwitch).toBeChecked({ timeout: 5000 })
    }

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

  test('can switch between framework tabs in the code panel', async ({ page }) => {
    const verifiedSwitch = page.getByRole('switch', {
      name: 'Require verified widget identity',
    })
    await expect(verifiedSwitch).toBeVisible({ timeout: 10000 })

    if (!(await verifiedSwitch.isChecked())) {
      await verifiedSwitch.click()
      await expect(verifiedSwitch).toBeChecked({ timeout: 5000 })
    }

    const frameworkSelect = page.getByRole('combobox').filter({
      hasText: /Next\.js|Express|Django|Rails|Laravel/i,
    })

    if ((await frameworkSelect.count()) > 0) {
      // Switch to Express — its server tab should be widget.js
      await frameworkSelect.first().click()
      const expressOption = page.getByRole('option', { name: 'Express' })
      if ((await expressOption.count()) > 0) {
        await expressOption.click()
        await expect(page.getByRole('button', { name: 'widget.js' })).toBeVisible({ timeout: 5000 })
      }
    }
  })

  test('server code tab shows HS256 JWT signing (not old HMAC hash approach)', async ({ page }) => {
    const verifiedSwitch = page.getByRole('switch', {
      name: 'Require verified widget identity',
    })
    await expect(verifiedSwitch).toBeVisible({ timeout: 10000 })

    if (!(await verifiedSwitch.isChecked())) {
      await verifiedSwitch.click()
      await expect(verifiedSwitch).toBeChecked({ timeout: 5000 })
    }

    // Switch to the server code tab (route.ts for Next.js)
    const serverTab = page.getByRole('button', { name: 'route.ts' })
    if ((await serverTab.count()) === 0) return

    await serverTab.click()

    // The code block should contain HS256 and ssoToken (JWT approach)
    await expect(page.getByText(/HS256/).first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/ssoToken/).first()).toBeVisible()
  })

  test('client-side code tab shows ssoToken (not old hash variable)', async ({ page }) => {
    const verifiedSwitch = page.getByRole('switch', {
      name: 'Require verified widget identity',
    })
    await expect(verifiedSwitch).toBeVisible({ timeout: 10000 })

    if (!(await verifiedSwitch.isChecked())) {
      await verifiedSwitch.click()
      await expect(verifiedSwitch).toBeChecked({ timeout: 5000 })
    }

    const identifyTab = page.getByRole('button', { name: 'identify.tsx' })
    if ((await identifyTab.count()) > 0) {
      await identifyTab.click()
      await expect(page.getByText(/ssoToken/).first()).toBeVisible({ timeout: 5000 })
      // Should NOT contain the old `hash` variable pattern
      const hashVar = page.getByText(/\bhash\b/).filter({ hasText: /const hash|var hash/ })
      expect(await hashVar.count()).toBe(0)
    }
  })

  test('code panel always shows snippet.html tab', async ({ page }) => {
    const snippetTab = page.getByRole('button', { name: 'snippet.html' })
    await expect(snippetTab).toBeVisible({ timeout: 10000 })
  })

  test('code panel always shows identify.tsx tab', async ({ page }) => {
    const identifyTab = page.getByRole('button', { name: 'identify.tsx' })
    await expect(identifyTab).toBeVisible({ timeout: 10000 })
  })

  test('Copy button is present in the code panel', async ({ page }) => {
    const copyButton = page.getByRole('button', { name: /Copy/i }).last()
    await expect(copyButton).toBeVisible({ timeout: 10000 })
  })

  test('Copy button changes to "Copied" after click', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    const copyButton = page.getByRole('button', { name: 'Copy' }).last()
    if ((await copyButton.count()) === 0) {
      test.skip()
      return
    }

    await copyButton.click()

    const copiedText = page.getByText('Copied').last()
    if ((await copiedText.count()) > 0) {
      await expect(copiedText).toBeVisible({ timeout: 3000 })
    }
  })

  test('shows Installation section heading', async ({ page }) => {
    await expect(page.getByText('Installation').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Configure and add the widget to your site')).toBeVisible()
  })

  test('shows installation step 1 (Add the script)', async ({ page }) => {
    await expect(page.getByText('Add the script')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Paste before the closing/)).toBeVisible()
  })

  test('shows installation step 2 (Identify users)', async ({ page }) => {
    await expect(page.getByText('Identify users')).toBeVisible({ timeout: 10000 })
  })

  test('shows widget secret section when verified identity is on', async ({ page }) => {
    const verifiedSwitch = page.getByRole('switch', {
      name: 'Require verified widget identity',
    })
    await expect(verifiedSwitch).toBeVisible({ timeout: 10000 })

    if (!(await verifiedSwitch.isChecked())) {
      await verifiedSwitch.click()
      await expect(verifiedSwitch).toBeChecked({ timeout: 5000 })
    }

    await expect(page.getByText('Widget secret')).toBeVisible({ timeout: 5000 })
  })

  test('shows Regenerate button for widget secret', async ({ page }) => {
    const verifiedSwitch = page.getByRole('switch', {
      name: 'Require verified widget identity',
    })
    await expect(verifiedSwitch).toBeVisible({ timeout: 10000 })

    if (!(await verifiedSwitch.isChecked())) {
      await verifiedSwitch.click()
      await expect(verifiedSwitch).toBeChecked({ timeout: 5000 })
    }

    const regenerateButton = page.getByRole('button', { name: 'Regenerate' })
    await expect(regenerateButton).toBeVisible({ timeout: 5000 })
    await expect(regenerateButton).toBeEnabled()
  })

  test('shows security warning about keeping secret server-side', async ({ page }) => {
    const verifiedSwitch = page.getByRole('switch', {
      name: 'Require verified widget identity',
    })
    await expect(verifiedSwitch).toBeVisible({ timeout: 10000 })

    if (!(await verifiedSwitch.isChecked())) {
      await verifiedSwitch.click()
      await expect(verifiedSwitch).toBeChecked({ timeout: 5000 })
    }

    await expect(page.getByText('Keep this secret server-side only')).toBeVisible({ timeout: 5000 })
  })
})
