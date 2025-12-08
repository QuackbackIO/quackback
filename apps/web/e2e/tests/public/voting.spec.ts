import { test, expect } from '@playwright/test'

test.describe('Public Voting', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the public portal
    await page.goto('/')
    // Wait for posts to load
    await page.waitForLoadState('networkidle')
  })

  test('displays vote count on posts', async ({ page }) => {
    // Look for vote buttons using data-testid
    const voteButtons = page.getByTestId('vote-button')

    await expect(voteButtons.first()).toBeVisible({ timeout: 10000 })

    // Vote count should be displayed as a number
    const voteCount = voteButtons.first().getByTestId('vote-count')
    await expect(voteCount).toBeVisible()
    const countText = await voteCount.textContent()
    expect(countText).toMatch(/^\d+$/)
  })

  test('can upvote a post', async ({ page }) => {
    // Use 2nd post to avoid conflicts with other tests
    const voteButtons = page.getByTestId('vote-button')
    const voteButton = voteButtons.nth(1)
    await expect(voteButton).toBeVisible({ timeout: 10000 })

    // Get the initial vote count
    const voteCountSpan = voteButton.getByTestId('vote-count')
    const initialCountText = await voteCountSpan.textContent()
    const initialCount = parseInt(initialCountText || '0', 10)

    // Click to vote
    await voteButton.click()

    // Wait for the vote to be processed and verify increase
    await expect(voteCountSpan).toHaveText(String(initialCount + 1), { timeout: 5000 })
  })

  test('can toggle vote off', async ({ page }) => {
    // Use 3rd post to avoid conflicts with other tests
    const voteButtons = page.getByTestId('vote-button')
    const voteButton = voteButtons.nth(2)
    await expect(voteButton).toBeVisible({ timeout: 10000 })

    const voteCountSpan = voteButton.getByTestId('vote-count')
    const initialCountText = await voteCountSpan.textContent()
    const initialCount = parseInt(initialCountText || '0', 10)

    // First click - vote (should increase by 1)
    await voteButton.click()
    await expect(voteCountSpan).toHaveText(String(initialCount + 1), { timeout: 5000 })

    // Second click - unvote (should return to initial count)
    await voteButton.click()
    await expect(voteCountSpan).toHaveText(String(initialCount), { timeout: 5000 })
  })

  test('vote button shows active state when voted', async ({ page }) => {
    // Use 4th post to avoid conflicts with other tests
    const voteButtons = page.getByTestId('vote-button')
    const voteButton = voteButtons.nth(3)
    await expect(voteButton).toBeVisible({ timeout: 10000 })

    // Click to vote
    await voteButton.click()

    // Button should have active styling (text-primary class)
    await expect(voteButton).toHaveClass(/text-primary/, { timeout: 5000 })
  })

  test('can vote on post detail page', async ({ page }) => {
    // Navigate to 5th post detail page to avoid conflicts with other tests
    const postLinks = page.locator('a[href*="/posts/"]')
    await expect(postLinks.nth(4)).toBeVisible({ timeout: 10000 })

    // Click the 5th post link
    await postLinks.nth(4).click()

    // Wait for URL to change to post detail page
    await page.waitForURL(/\/posts\//)

    // Wait for detail page vote button specifically (has text-lg class, list view has text-sm)
    const detailVoteCount = page.locator('[data-testid="vote-count"].text-lg')
    await expect(detailVoteCount).toBeVisible({ timeout: 10000 })

    // Get initial count from detail page
    const initialCountText = await detailVoteCount.textContent()
    const initialCount = parseInt(initialCountText || '0', 10)

    // Find and click the vote button on detail page
    const voteButton = page.getByTestId('vote-button')
    await voteButton.click()

    // Verify count increased
    await expect(detailVoteCount).toHaveText(String(initialCount + 1), { timeout: 5000 })
  })
})
