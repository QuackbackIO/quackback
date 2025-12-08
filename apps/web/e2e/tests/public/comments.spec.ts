import { test, expect } from '@playwright/test'

test.describe('Public Comments', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a post detail page
    await page.goto('/')

    // Wait for posts to load
    const postCards = page.locator('a[href*="/posts/"]:has(h3)')
    await expect(postCards.first()).toBeVisible({ timeout: 15000 })

    // Click on the first post card to go to detail page
    await postCards.first().click()

    // Wait for detail page to load by checking for comment section
    await expect(
      page.getByPlaceholder('Write a comment...').or(page.getByText(/no comments yet/i))
    ).toBeVisible({ timeout: 10000 })
  })

  test('displays comments section on post detail', async ({ page }) => {
    // Should show comment form with placeholder "Write a comment..." or empty state
    const commentSection = page
      .getByPlaceholder('Write a comment...')
      .or(page.getByText(/no comments yet/i))

    await expect(commentSection.first()).toBeVisible({ timeout: 10000 })
  })

  test('shows comment form with textarea', async ({ page }) => {
    // Should have a textarea with placeholder "Write a comment..."
    const commentTextarea = page.getByPlaceholder('Write a comment...')

    await expect(commentTextarea).toBeVisible({ timeout: 10000 })
  })

  test('can write and submit a comment', async ({ page }) => {
    // Find the comment textarea with exact placeholder
    const commentTextarea = page.getByPlaceholder('Write a comment...')

    // Write a comment
    const testComment = `Test comment ${Date.now()}`
    await commentTextarea.fill(testComment)

    // Find and click the submit button - it's the button with type="submit" in the form
    const submitButton = page.locator('form button[type="submit"]').first()

    // Click and wait for the response
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/comments')),
      submitButton.click(),
    ])

    // The new comment should appear
    await expect(page.getByText(testComment)).toBeVisible({ timeout: 10000 })
  })

  test('displays existing comments or empty state', async ({ page }) => {
    // Either show "No comments yet" message or the comment form textarea
    const noComments = page.getByText(/no comments yet.*be the first/i)
    const commentTextarea = page.getByPlaceholder('Write a comment...')

    // One of these should be visible
    await expect(noComments.or(commentTextarea)).toBeVisible({ timeout: 10000 })
  })

  test('shows reply button on comments', async ({ page }) => {
    // First check if there are any comments (not just the empty state)
    const noComments = await page.getByText(/no comments yet.*be the first/i).count()

    if (noComments === 0) {
      // There are comments - look for reply buttons using data-testid
      const replyButtons = page.getByTestId('reply-button')
      await expect(replyButtons.first()).toBeVisible({ timeout: 5000 })
    }
  })

  test('can open reply form', async ({ page }) => {
    // First check if there are any comments
    const noComments = await page.getByText(/no comments yet.*be the first/i).count()

    if (noComments === 0) {
      // There are comments - find and click reply button using data-testid
      const replyButton = page.getByTestId('reply-button')
      await replyButton.first().click()

      // Reply form should appear - there will now be 2 textareas on the page
      // (the main comment form and the reply form)
      const textareas = page.locator('textarea')
      await expect(textareas).toHaveCount(2, { timeout: 5000 })

      // Both should have the same placeholder
      await expect(textareas.nth(1)).toHaveAttribute('placeholder', 'Write a comment...')
    }
  })

  test('shows emoji reaction picker', async ({ page }) => {
    // First check if there are any comments
    const noComments = await page.getByText(/no comments yet.*be the first/i).count()

    if (noComments === 0) {
      // There are comments - find reaction button using data-testid
      const reactionButton = page.getByTestId('add-reaction-button')
      await expect(reactionButton.first()).toBeVisible({ timeout: 5000 })
      await reactionButton.first().click()

      // Emoji picker popover should appear using data-testid
      const emojiPopover = page.getByTestId('emoji-picker')
      await expect(emojiPopover).toBeVisible({ timeout: 5000 })

      // Should show emoji options as buttons using data-testid
      const emojiButtons = page.getByTestId('emoji-option')
      await expect(emojiButtons.first()).toBeVisible()

      // Close popover
      await page.keyboard.press('Escape')
    }
  })

  test('can add emoji reaction to comment', async ({ page }) => {
    // First check if there are any comments
    const noComments = await page.getByText(/no comments yet.*be the first/i).count()

    if (noComments === 0) {
      // There are comments - find and click reaction button using data-testid
      const reactionButton = page.getByTestId('add-reaction-button')
      await reactionButton.first().click()

      // Find emoji picker using data-testid
      const emojiPopover = page.getByTestId('emoji-picker')
      await expect(emojiPopover).toBeVisible({ timeout: 5000 })

      // Click an emoji button and wait for the API response
      const emojiButton = page.getByTestId('emoji-option').first()
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('/reactions')),
        emojiButton.click(),
      ])

      // Reaction should be added - popover closes automatically
      await expect(emojiPopover).not.toBeVisible({ timeout: 5000 })

      // A reaction badge should now appear using data-testid
      const reactionBadge = page.getByTestId('reaction-badge')
      await expect(reactionBadge.first()).toBeVisible({ timeout: 5000 })
    }
  })

  test('shows team member badge on admin comments', async ({ page }) => {
    // First check if there are any comments
    const noComments = await page.getByText(/no comments yet.*be the first/i).count()

    if (noComments === 0) {
      // Look for team member badge with text "Team"
      // Only check if it exists - not all comments may be from team members
      const teamBadge = page.locator('span.bg-primary:has-text("Team")')
      const teamBadgeCount = await teamBadge.count()

      // If there are team member comments, the badge should be visible
      if (teamBadgeCount > 0) {
        await expect(teamBadge.first()).toBeVisible()
      }
    }
  })

  test('comments show author name and timestamp', async ({ page }) => {
    // First check if there are any comments
    const noComments = await page.getByText(/no comments yet.*be the first/i).count()

    if (noComments === 0) {
      // Has comments - check for author name and timestamp
      // Author name is in a span with font-medium class next to the avatar
      const authorName = page.locator('span.font-medium.text-sm')
      await expect(authorName.first()).toBeVisible({ timeout: 5000 })

      // Timestamps are rendered using the TimeAgo component with text like "X days ago"
      // Look for text that matches the timestamp pattern
      const timestamp = page.getByText(/\d+ (second|minute|hour|day|week|month|year)s? ago/)
      await expect(timestamp.first()).toBeVisible({ timeout: 5000 })
    }
  })
})
