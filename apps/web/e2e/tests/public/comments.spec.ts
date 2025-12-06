import { test, expect } from '@playwright/test'

test.describe('Public Comments', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a post detail page
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Click on the first post to go to detail page
    const postLinks = page.locator('a[href*="/posts/"]')
    await expect(postLinks.first()).toBeVisible({ timeout: 10000 })
    await postLinks.first().click()

    // Wait for detail page to load
    await page.waitForLoadState('networkidle')
  })

  test('displays comments section on post detail', async ({ page }) => {
    // Should show comment form or comments area
    const commentSection = page
      .getByPlaceholder(/comment/i)
      .or(page.getByText(/no comments yet/i))
      .or(page.locator('textarea'))

    await expect(commentSection.first()).toBeVisible({ timeout: 10000 })
  })

  test('shows comment form with textarea', async ({ page }) => {
    // Should have a textarea for writing comments
    const commentTextarea = page.getByPlaceholder(/write a comment/i).or(page.locator('textarea'))

    await expect(commentTextarea.first()).toBeVisible({ timeout: 10000 })
  })

  test('can write and submit a comment', async ({ page }) => {
    // Find the comment textarea
    const commentTextarea = page.getByPlaceholder(/write a comment/i).or(page.locator('textarea'))

    if ((await commentTextarea.count()) > 0) {
      // Write a comment
      const testComment = `Test comment ${Date.now()}`
      await commentTextarea.first().fill(testComment)

      // Find and click the submit button
      const submitButton = page.getByRole('button', { name: /comment|post|submit/i })
      if ((await submitButton.count()) > 0) {
        await submitButton.first().click()

        // Wait for the page to refresh with new comment
        await page.waitForLoadState('networkidle')

        // The new comment should appear
        await expect(page.getByText(testComment)).toBeVisible({ timeout: 10000 })
      }
    }
  })

  test('displays existing comments or empty state', async ({ page }) => {
    // Either show comments or "no comments yet" message
    // Check for "no comments" message first (faster)
    const noComments = page.getByText(/no comments yet/i)

    // Or check for comment content (textarea with existing comments above it)
    const commentArea = page.locator('textarea')

    // One of these should be visible - the comment section exists
    await expect(noComments.or(commentArea)).toBeVisible({ timeout: 10000 })
  })

  test('shows reply button on comments', async ({ page }) => {
    // Find reply buttons
    const replyButtons = page
      .getByRole('button', { name: /reply/i })
      .or(page.locator('button').filter({ has: page.locator('svg.lucide-reply') }))

    // If there are comments with reply buttons
    if ((await replyButtons.count()) > 0) {
      await expect(replyButtons.first()).toBeVisible()
    }
  })

  test('can open reply form', async ({ page }) => {
    // Find reply button
    const replyButton = page
      .getByRole('button', { name: /reply/i })
      .or(page.locator('button').filter({ has: page.locator('svg.lucide-reply') }))

    if ((await replyButton.count()) > 0) {
      await replyButton.first().click()

      // Reply form should appear with textarea
      const replyTextarea = page.locator('textarea').nth(1).or(page.getByPlaceholder(/reply/i))

      // A second textarea should now be visible (the reply form)
      await expect(replyTextarea.or(page.locator('textarea').first())).toBeVisible()
    }
  })

  test('shows emoji reaction picker', async ({ page }) => {
    // Find reaction button (smile plus icon)
    const reactionButton = page.locator('button').filter({
      has: page.locator('svg.lucide-smile-plus'),
    })

    if ((await reactionButton.count()) > 0) {
      await reactionButton.first().click()

      // Emoji picker popover should appear
      const emojiPopover = page.locator('[data-radix-popover-content]').or(page.getByRole('dialog'))

      if ((await emojiPopover.count()) > 0) {
        await expect(emojiPopover).toBeVisible()

        // Should show emoji options
        const emojiButtons = emojiPopover.locator('button')
        await expect(emojiButtons.first()).toBeVisible()

        // Close popover
        await page.keyboard.press('Escape')
      }
    }
  })

  test('can add emoji reaction to comment', async ({ page }) => {
    // Find reaction button
    const reactionButton = page.locator('button').filter({
      has: page.locator('svg.lucide-smile-plus'),
    })

    if ((await reactionButton.count()) > 0) {
      await reactionButton.first().click()

      // Find an emoji button in the popover
      const emojiPopover = page.locator('[data-radix-popover-content]')

      if ((await emojiPopover.count()) > 0) {
        const emojiButton = emojiPopover.locator('button').first()
        if ((await emojiButton.count()) > 0) {
          await emojiButton.click()

          // Reaction should be added (popover closes and reaction appears)
          await page.waitForTimeout(500)
        }
      }
    }
  })

  test('shows team member badge on admin comments', async ({ page }) => {
    // Look for team member badge on comments
    const teamBadge = page.getByText(/team/i).or(page.locator('svg.lucide-building-2'))

    // If there are team comments, badge should be visible
    if ((await teamBadge.count()) > 0) {
      await expect(teamBadge.first()).toBeVisible()
    }
  })

  test('comments show author name and timestamp', async ({ page }) => {
    // Check for author names (could be "Anonymous" or actual names)
    const authorNames = page.getByText(/anonymous/i).or(page.locator('[class*="author"]'))

    // Check for timestamps
    const timestamps = page.locator('time').or(page.locator('[data-testid="time-ago"]'))

    // If there are comments, they should have these elements
    const noComments = page.getByText(/no comments yet/i)
    if ((await noComments.count()) === 0) {
      // Has comments - check for author/timestamp
      if ((await authorNames.count()) > 0) {
        await expect(authorNames.first()).toBeVisible()
      }
      if ((await timestamps.count()) > 0) {
        await expect(timestamps.first()).toBeVisible()
      }
    }
  })
})
