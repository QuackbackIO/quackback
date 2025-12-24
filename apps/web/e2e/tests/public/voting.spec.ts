import { test, expect, Page, BrowserContext } from '@playwright/test'
import { getOtpCode } from '../../utils/db-helpers'

const TEST_EMAIL = 'demo@example.com'
const TEST_HOST = 'acme.localhost:3000'

/**
 * Helper to authenticate a user via OTP flow
 * This function attempts to handle rate limiting gracefully
 */
async function authenticateViaOTP(page: Page, maxRetries = 8) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Request OTP code
      const sendResponse = await page.request.post('/api/auth/email-otp/send-verification-otp', {
        headers: { 'Content-Type': 'application/json' },
        data: {
          email: TEST_EMAIL,
          type: 'sign-in',
        },
      })

      // If rate limited, wait and retry with exponential backoff
      if (sendResponse.status() === 429) {
        const waitTime = Math.min(2000 * Math.pow(2, attempt), 20000) // Max 20 seconds per attempt
        console.log(
          `Rate limited on attempt ${attempt + 1}/${maxRetries}, waiting ${waitTime}ms...`
        )
        await page.waitForTimeout(waitTime)
        continue
      }

      if (!sendResponse.ok()) {
        const errorData = await sendResponse.json()
        console.error('Failed to send OTP:', errorData)
        throw new Error(`Failed to send OTP: ${JSON.stringify(errorData)}`)
      }

      // Get OTP code from database
      const otpCode = getOtpCode(TEST_EMAIL, TEST_HOST)

      // Verify OTP code - Better-auth sets session cookie automatically
      const verifyResponse = await page.request.post('/api/auth/sign-in/email-otp', {
        headers: { 'Content-Type': 'application/json' },
        data: {
          email: TEST_EMAIL,
          otp: otpCode,
        },
      })

      if (!verifyResponse.ok()) {
        const errorData = await verifyResponse.json()
        console.error('Failed to verify OTP:', errorData)
        throw new Error(`Failed to verify OTP: ${JSON.stringify(errorData)}`)
      }

      // Session cookie is now set by Better-auth
      // Navigate to any page to verify authentication
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      console.log('Authentication successful!')
      return // Success!
    } catch (error) {
      if (attempt === maxRetries - 1) {
        console.error(`All ${maxRetries} authentication attempts failed.`)
        throw error // Last attempt failed, re-throw
      }
      console.log(`Auth attempt ${attempt + 1} failed, retrying...`)
      await page.waitForTimeout(3000)
    }
  }
}

test.describe.configure({ mode: 'serial' })

test.describe('Public Voting', () => {
  let sharedContext: BrowserContext
  let isAuthenticated = false

  // Increase timeout to 90 seconds to handle rate limiting
  test.setTimeout(90000)

  test.beforeAll(async ({ browser }) => {
    // Create a shared context and authenticate once for all tests
    // Note: This may take longer if rate limits are active
    sharedContext = await browser.newContext()
    const page = await sharedContext.newPage()
    await authenticateViaOTP(page)
    isAuthenticated = true
    await page.close()
  })

  test.afterAll(async () => {
    if (sharedContext) {
      await sharedContext.close()
    }
  })

  test.beforeEach(async () => {
    expect(isAuthenticated).toBe(true)
  })

  test('displays vote count on posts', async () => {
    const page = await sharedContext.newPage()
    try {
      // Navigate to the public portal
      await page.goto('/')
      // Wait for posts to load
      await page.waitForLoadState('networkidle')

      // Look for vote buttons using data-testid
      const voteButtons = page.getByTestId('vote-button')

      await expect(voteButtons.first()).toBeVisible({ timeout: 10000 })

      // Vote count should be displayed as a number
      const voteCount = voteButtons.first().getByTestId('vote-count')
      await expect(voteCount).toBeVisible()
      const countText = await voteCount.textContent()
      expect(countText).toMatch(/^\d+$/)
    } finally {
      await page.close()
    }
  })

  test('can upvote a post (from unvoted state)', async () => {
    const page = await sharedContext.newPage()
    try {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Use 6th post to avoid conflicts with other tests
      const voteButtons = page.getByTestId('vote-button')
      const voteButton = voteButtons.nth(5)
      await expect(voteButton).toBeVisible({ timeout: 10000 })

      const voteCountSpan = voteButton.getByTestId('vote-count')

      // Check if already voted (button has active class)
      const isAlreadyVoted = await voteButton.evaluate((el) =>
        el.classList.contains('post-card__vote--voted')
      )

      // If already voted, click to remove vote first to get to clean state
      if (isAlreadyVoted) {
        await voteButton.click()
        // Wait for unvoted state to be reflected
        await expect(voteButton).not.toHaveClass(/post-card__vote--voted/, { timeout: 5000 })
        await page.waitForLoadState('networkidle')
      }

      // Now get the baseline count (user has not voted)
      const baselineCountText = await voteCountSpan.textContent()
      const baselineCount = parseInt(baselineCountText || '0', 10)

      // Click to add vote
      await voteButton.click()

      // Wait for voted state first (more reliable than checking count)
      await expect(voteButton).toHaveClass(/post-card__vote--voted/, { timeout: 5000 })

      // Verify the count increased
      await expect(voteCountSpan).toHaveText(String(baselineCount + 1), { timeout: 5000 })
    } finally {
      await page.close()
    }
  })

  test('can remove vote (from voted state)', async () => {
    const page = await sharedContext.newPage()
    try {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Use 7th post to avoid conflicts with other tests
      const voteButtons = page.getByTestId('vote-button')
      const voteButton = voteButtons.nth(6)
      await expect(voteButton).toBeVisible({ timeout: 10000 })

      const voteCountSpan = voteButton.getByTestId('vote-count')

      // Check if already voted
      const isAlreadyVoted = await voteButton.evaluate((el) =>
        el.classList.contains('post-card__vote--voted')
      )

      // If not voted, click to add vote first to get to voted state
      if (!isAlreadyVoted) {
        await voteButton.click()
        // Wait for voted state to be reflected
        await expect(voteButton).toHaveClass(/post-card__vote--voted/, { timeout: 5000 })
        await page.waitForLoadState('networkidle')
      }

      // Now get the baseline count (user has voted)
      const baselineCountText = await voteCountSpan.textContent()
      const baselineCount = parseInt(baselineCountText || '0', 10)

      // Click to remove vote
      await voteButton.click()

      // Wait for unvoted state first (more reliable than checking count)
      await expect(voteButton).not.toHaveClass(/post-card__vote--voted/, { timeout: 5000 })

      // Verify the count decreased
      await expect(voteCountSpan).toHaveText(String(baselineCount - 1), { timeout: 5000 })
    } finally {
      await page.close()
    }
  })

  test('can toggle vote on and off', async () => {
    const page = await sharedContext.newPage()
    try {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Use 8th post to avoid conflicts with other tests
      const voteButtons = page.getByTestId('vote-button')
      const voteButton = voteButtons.nth(7)
      await expect(voteButton).toBeVisible({ timeout: 10000 })

      const voteCountSpan = voteButton.getByTestId('vote-count')

      // Ensure we start from unvoted state
      const isAlreadyVoted = await voteButton.evaluate((el) =>
        el.classList.contains('post-card__vote--voted')
      )
      if (isAlreadyVoted) {
        await voteButton.click()
        await page.waitForTimeout(500)
      }

      const initialCountText = await voteCountSpan.textContent()
      const initialCount = parseInt(initialCountText || '0', 10)

      // First click - vote (should increase by 1)
      await voteButton.click()
      await expect(voteCountSpan).toHaveText(String(initialCount + 1), { timeout: 5000 })
      await expect(voteButton).toHaveClass(/post-card__vote--voted/, { timeout: 2000 })

      // Second click - unvote (should return to initial count)
      await voteButton.click()
      await expect(voteCountSpan).toHaveText(String(initialCount), { timeout: 5000 })
      await expect(voteButton).not.toHaveClass(/post-card__vote--voted/, { timeout: 2000 })
    } finally {
      await page.close()
    }
  })

  test('can vote on post detail page', async () => {
    const page = await sharedContext.newPage()
    try {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Navigate to 9th post detail page to avoid conflicts with other tests
      const postLinks = page.locator('a[href*="/posts/"]')
      await expect(postLinks.nth(8)).toBeVisible({ timeout: 10000 })

      // Click the 9th post link
      await postLinks.nth(8).click()

      // Wait for URL to change to post detail page
      await page.waitForURL(/\/posts\//)

      // Wait for detail page vote button specifically (has text-lg class, list view has text-sm)
      // Scope to the detail view vote button that contains the text-lg vote count
      const detailVoteButton = page.getByTestId('vote-button').filter({
        has: page.locator('[data-testid="vote-count"].text-lg'),
      })
      await expect(detailVoteButton).toBeVisible({ timeout: 10000 })

      const voteCountSpan = detailVoteButton.getByTestId('vote-count')

      // Ensure we start from unvoted state (check aria-pressed which works across all vote buttons)
      const isAlreadyVoted = (await detailVoteButton.getAttribute('aria-pressed')) === 'true'
      if (isAlreadyVoted) {
        await detailVoteButton.click()
        // Wait for unvoted state
        await expect(detailVoteButton).toHaveAttribute('aria-pressed', 'false', { timeout: 5000 })
        await page.waitForLoadState('networkidle')
      }

      // Get baseline count from the detail page vote button
      const baselineCountText = await voteCountSpan.textContent()
      const baselineCount = parseInt(baselineCountText || '0', 10)

      // Click the detail page vote button to add vote
      await detailVoteButton.click()

      // Verify button shows voted state (aria-pressed is more reliable than class name)
      await expect(detailVoteButton).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 })

      // Verify count increased
      await expect(voteCountSpan).toHaveText(String(baselineCount + 1), { timeout: 5000 })
    } finally {
      await page.close()
    }
  })
})

test.describe('Unauthenticated Voting', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the public portal without authentication
    await page.goto('/')
    // Wait for posts to load
    await page.waitForLoadState('networkidle')
  })

  test('shows vote count for unauthenticated users', async ({ page }) => {
    // Look for vote buttons using data-testid
    const voteButtons = page.getByTestId('vote-button')
    await expect(voteButtons.first()).toBeVisible({ timeout: 10000 })

    // Vote count should be displayed as a number
    const voteCount = voteButtons.first().getByTestId('vote-count')
    await expect(voteCount).toBeVisible()
    const countText = await voteCount.textContent()
    expect(countText).toMatch(/^\d+$/)
  })

  test('clicking vote button opens auth dialog', async ({ page }) => {
    // Click on a vote button
    const voteButtons = page.getByTestId('vote-button')
    await expect(voteButtons.first()).toBeVisible({ timeout: 10000 })
    await voteButtons.first().click()

    // Auth dialog should open - look for OTP input or sign in form
    const authDialog = page.locator('[role="dialog"]').filter({ hasText: /sign in|log in|email/i })
    await expect(authDialog).toBeVisible({ timeout: 5000 })
  })
})
