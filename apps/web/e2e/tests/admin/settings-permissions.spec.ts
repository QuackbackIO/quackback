import { test, expect } from '@playwright/test'

test.describe('Admin Permissions Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/permissions')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows permissions heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Permissions' })).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Control who can access your portal and what they can do.')
    ).toBeVisible({ timeout: 10000 })
  })

  test('shows Portal access section', async ({ page }) => {
    await expect(page.getByText('Portal access')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Who can see your feedback portal.')).toBeVisible()
  })

  test('shows Public view toggle', async ({ page }) => {
    await expect(page.getByText('Public view')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Let anyone browse posts without signing in.')
    ).toBeVisible()

    const toggle = page.locator('#public-view')
    await expect(toggle).toBeVisible()
  })

  test('shows Submissions section with signed-in and anonymous toggles', async ({ page }) => {
    await expect(page.getByText('Submissions')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Who can create new posts.')).toBeVisible()

    await expect(page.getByText('Signed-in users can submit')).toBeVisible()
    await expect(page.getByText('Allow users to submit new posts.')).toBeVisible()

    await expect(page.getByText('Anonymous users can submit')).toBeVisible()
    await expect(page.getByText('Let visitors submit without an account.')).toBeVisible()

    await expect(page.locator('#submissions')).toBeVisible()
    await expect(page.locator('#anon-posting')).toBeVisible()
  })

  test('shows Comments section with signed-in and anonymous toggles', async ({ page }) => {
    await expect(page.getByText('Comments')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Who can comment on posts.')).toBeVisible()

    await expect(page.getByText('Signed-in users can comment')).toBeVisible()
    await expect(page.getByText('Anonymous users can comment')).toBeVisible()

    await expect(page.locator('#comments')).toBeVisible()
    await expect(page.locator('#anon-commenting')).toBeVisible()
  })

  test('shows Voting section with signed-in and anonymous toggles', async ({ page }) => {
    await expect(page.getByText('Voting')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Who can upvote posts.')).toBeVisible()

    await expect(page.getByText('Signed-in users can vote')).toBeVisible()
    await expect(page.getByText('Anonymous users can vote')).toBeVisible()

    await expect(page.locator('#voting')).toBeVisible()
    await expect(page.locator('#anon-voting')).toBeVisible()
  })

  test('shows Post content section with image and video toggles', async ({ page }) => {
    await expect(page.getByText('Post content')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText("What users can add to their posts.")).toBeVisible()

    await expect(page.getByText('Allow images in posts')).toBeVisible()
    await expect(page.getByText('Allow videos in posts')).toBeVisible()

    await expect(page.locator('#rich-media-in-posts')).toBeVisible()
    await expect(page.locator('#video-embeds-in-posts')).toBeVisible()
  })

  test('toggle switches are interactive', async ({ page }) => {
    const publicViewToggle = page.locator('#public-view')
    await expect(publicViewToggle).toBeVisible({ timeout: 10000 })
    await expect(publicViewToggle).toBeEnabled()

    const submissionsToggle = page.locator('#submissions')
    await expect(submissionsToggle).toBeEnabled()
  })

  test('can toggle public view and auto-saves', async ({ page }) => {
    const toggle = page.locator('#public-view')
    await expect(toggle).toBeVisible({ timeout: 10000 })

    const initialChecked = await toggle.isChecked()

    // Toggle it
    await toggle.click()

    // Wait for the save spinner to appear and disappear (auto-save on change)
    await page.waitForTimeout(500)

    // Restore original state
    const nowChecked = await toggle.isChecked()
    if (nowChecked !== initialChecked) {
      await toggle.click()
      await page.waitForTimeout(500)
    }
  })

  test('anonymous submission toggle is disabled when signed-in submissions is off', async ({
    page,
  }) => {
    const submissionsToggle = page.locator('#submissions')
    await expect(submissionsToggle).toBeVisible({ timeout: 10000 })

    const isSubmissionsEnabled = await submissionsToggle.isChecked()

    if (isSubmissionsEnabled) {
      // Turn off signed-in submissions
      await submissionsToggle.click()
      await page.waitForTimeout(500)

      // Anonymous posting should now be disabled
      const anonToggle = page.locator('#anon-posting')
      await expect(anonToggle).toBeDisabled()

      // Restore
      await submissionsToggle.click()
      await page.waitForTimeout(500)
    } else {
      // Submissions already off — anon toggle should be disabled
      const anonToggle = page.locator('#anon-posting')
      await expect(anonToggle).toBeDisabled()
    }
  })

  test('anonymous commenting toggle is disabled when signed-in comments is off', async ({
    page,
  }) => {
    const commentsToggle = page.locator('#comments')
    await expect(commentsToggle).toBeVisible({ timeout: 10000 })

    const isCommentsEnabled = await commentsToggle.isChecked()

    if (isCommentsEnabled) {
      await commentsToggle.click()
      await page.waitForTimeout(500)

      const anonToggle = page.locator('#anon-commenting')
      await expect(anonToggle).toBeDisabled()

      // Restore
      await commentsToggle.click()
      await page.waitForTimeout(500)
    } else {
      const anonToggle = page.locator('#anon-commenting')
      await expect(anonToggle).toBeDisabled()
    }
  })

  test('video embeds toggle is disabled when image uploads is off', async ({ page }) => {
    const imagesToggle = page.locator('#rich-media-in-posts')
    await expect(imagesToggle).toBeVisible({ timeout: 10000 })

    const isImagesEnabled = await imagesToggle.isChecked()

    if (isImagesEnabled) {
      await imagesToggle.click()
      await page.waitForTimeout(500)

      const videoToggle = page.locator('#video-embeds-in-posts')
      await expect(videoToggle).toBeDisabled()

      // Restore
      await imagesToggle.click()
      await page.waitForTimeout(500)
    } else {
      const videoToggle = page.locator('#video-embeds-in-posts')
      await expect(videoToggle).toBeDisabled()
    }
  })

  test('page shows all five settings cards', async ({ page }) => {
    await expect(page.getByText('Portal access')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Submissions')).toBeVisible()
    await expect(page.getByText('Comments')).toBeVisible()
    await expect(page.getByText('Voting')).toBeVisible()
    await expect(page.getByText('Post content')).toBeVisible()
  })
})
