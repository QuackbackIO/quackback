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

      // Wait for detail page vote button specifically.
      // The VoteSidebar vote button is in a Suspense boundary; use aria-pressed to confirm it loaded.
      // Both list and detail use text-sm, so just use the first vote button on the detail page.
      const detailVoteButton = page.getByTestId('vote-button').first()
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

test.describe('Anonymous Voting (unauthenticated)', () => {
  // Anonymous voting is enabled by default — unauthenticated users can vote
  // without seeing an auth dialog (a silent anonymous session is created).
  test.setTimeout(60000)

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('shows vote count for unauthenticated users', async ({ page }) => {
    const voteButtons = page.getByTestId('vote-button')
    await expect(voteButtons.first()).toBeVisible({ timeout: 10000 })

    const voteCount = voteButtons.first().getByTestId('vote-count')
    await expect(voteCount).toBeVisible()
    const countText = await voteCount.textContent()
    expect(countText).toMatch(/^\d+$/)
  })

  test('anonymous user can vote without signing in', async ({ page }) => {
    // Use 10th post to avoid conflicts with authenticated voting tests
    const voteButtons = page.getByTestId('vote-button')
    const voteButton = voteButtons.nth(9)
    await expect(voteButton).toBeVisible({ timeout: 10000 })

    const voteCountSpan = voteButton.getByTestId('vote-count')

    // Ensure we start from unvoted state
    const isAlreadyVoted = await voteButton.evaluate((el) =>
      el.classList.contains('post-card__vote--voted')
    )
    if (isAlreadyVoted) {
      await voteButton.click()
      await expect(voteButton).not.toHaveClass(/post-card__vote--voted/, { timeout: 10000 })
      await page.waitForLoadState('networkidle')
    }

    const baselineCountText = await voteCountSpan.textContent()
    const baselineCount = parseInt(baselineCountText || '0', 10)

    // Click vote — anonymous sign-in happens silently, then vote fires
    await voteButton.click()

    // Vote count should increase (no auth dialog shown)
    await expect(voteCountSpan).toHaveText(String(baselineCount + 1), { timeout: 10000 })
    await expect(voteButton).toHaveClass(/post-card__vote--voted/, { timeout: 5000 })

    // Auth dialog should NOT appear
    const authDialog = page.locator('[role="dialog"]').filter({ hasText: /sign in|log in|email/i })
    await expect(authDialog).not.toBeVisible()
  })

  test('anonymous user can toggle vote off', async ({ page }) => {
    // Use 11th post to avoid conflicts
    const voteButtons = page.getByTestId('vote-button')
    const voteButton = voteButtons.nth(10)
    await expect(voteButton).toBeVisible({ timeout: 10000 })

    const voteCountSpan = voteButton.getByTestId('vote-count')

    // Ensure we start from unvoted state
    const isAlreadyVoted = await voteButton.evaluate((el) =>
      el.classList.contains('post-card__vote--voted')
    )
    if (isAlreadyVoted) {
      await voteButton.click()
      await expect(voteButton).not.toHaveClass(/post-card__vote--voted/, { timeout: 10000 })
      await page.waitForLoadState('networkidle')
    }

    const baselineCountText = await voteCountSpan.textContent()
    const baselineCount = parseInt(baselineCountText || '0', 10)

    // First click — vote
    await voteButton.click()
    await expect(voteCountSpan).toHaveText(String(baselineCount + 1), { timeout: 10000 })

    // Second click — unvote
    await voteButton.click()
    await expect(voteCountSpan).toHaveText(String(baselineCount), { timeout: 10000 })
    await expect(voteButton).not.toHaveClass(/post-card__vote--voted/, { timeout: 5000 })
  })
})

test.describe('Voting — count display and accessibility', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('vote count is shown as a plain number (not empty or NaN)', async ({ page }) => {
    const voteButtons = page.getByTestId('vote-button')
    await expect(voteButtons.first()).toBeVisible({ timeout: 10000 })

    // Check the first five visible posts — every count must be a non-empty integer
    const count = Math.min(await voteButtons.count(), 5)
    for (let i = 0; i < count; i++) {
      const countSpan = voteButtons.nth(i).getByTestId('vote-count')
      const text = await countSpan.textContent()
      expect(text).not.toBe('')
      expect(text).not.toBeNull()
      expect(Number.isNaN(Number(text))).toBe(false)
      // Must be a whole number string (no decimals, no "NaN", no undefined)
      expect(text).toMatch(/^\d+$/)
    }
  })

  test('vote button has aria-pressed attribute for accessibility', async ({ page }) => {
    const voteButtons = page.getByTestId('vote-button')
    await expect(voteButtons.first()).toBeVisible({ timeout: 10000 })

    const ariaPressed = await voteButtons.first().getAttribute('aria-pressed')
    // aria-pressed must be "true" or "false" — not null or missing
    expect(['true', 'false']).toContain(ariaPressed)
  })
})

test.describe('Voting — independence and persistence', () => {
  test.setTimeout(90000)

  // Use a fresh authenticated context for persistence tests so votes survive navigation
  let sharedContext: import('@playwright/test').BrowserContext

  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext()
    const page = await sharedContext.newPage()
    // Use the OTP auth helper already tested in the Public Voting suite
    // (relies on the same demo@example.com account and db-helpers)
    const { getOtpCode } = await import('../../utils/db-helpers')

    const TEST_EMAIL = 'demo@example.com'
    const TEST_HOST = 'acme.localhost:3000'

    const sendResponse = await page.request.post('/api/auth/email-otp/send-verification-otp', {
      headers: { 'Content-Type': 'application/json' },
      data: { email: TEST_EMAIL, type: 'sign-in' },
    })
    if (!sendResponse.ok()) throw new Error('Failed to send OTP for persistence tests')

    const otpCode = getOtpCode(TEST_EMAIL, TEST_HOST)
    const verifyResponse = await page.request.post('/api/auth/sign-in/email-otp', {
      headers: { 'Content-Type': 'application/json' },
      data: { email: TEST_EMAIL, otp: otpCode },
    })
    if (!verifyResponse.ok()) throw new Error('Failed to verify OTP for persistence tests')

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.close()
  })

  test.afterAll(async () => {
    if (sharedContext) await sharedContext.close()
  })

  test('multiple posts can be voted on independently', async () => {
    const page = await sharedContext.newPage()
    try {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const voteButtons = page.getByTestId('vote-button')
      await expect(voteButtons.first()).toBeVisible({ timeout: 10000 })

      // Use posts 12 and 13 (0-indexed) to stay clear of other test slots
      const buttonA = voteButtons.nth(12)
      const buttonB = voteButtons.nth(13)

      const countSpanA = buttonA.getByTestId('vote-count')
      const countSpanB = buttonB.getByTestId('vote-count')

      // Normalise both to unvoted state
      for (const btn of [buttonA, buttonB]) {
        const voted = await btn.evaluate((el) => el.classList.contains('post-card__vote--voted'))
        if (voted) {
          await btn.click()
          await expect(btn).not.toHaveClass(/post-card__vote--voted/, { timeout: 5000 })
          await page.waitForLoadState('networkidle')
        }
      }

      const baseA = parseInt((await countSpanA.textContent()) || '0', 10)
      const baseB = parseInt((await countSpanB.textContent()) || '0', 10)

      // Vote on post A only
      await buttonA.click()
      await expect(buttonA).toHaveClass(/post-card__vote--voted/, { timeout: 5000 })
      await expect(countSpanA).toHaveText(String(baseA + 1), { timeout: 5000 })

      // Post B must be unchanged
      await expect(countSpanB).toHaveText(String(baseB), { timeout: 2000 })
      await expect(buttonB).not.toHaveClass(/post-card__vote--voted/)

      // Vote on post B
      await buttonB.click()
      await expect(buttonB).toHaveClass(/post-card__vote--voted/, { timeout: 5000 })
      await expect(countSpanB).toHaveText(String(baseB + 1), { timeout: 5000 })

      // Post A count stays at baseA + 1
      await expect(countSpanA).toHaveText(String(baseA + 1), { timeout: 2000 })
    } finally {
      await page.close()
    }
  })

  test('vote persists after navigating away and returning to post list', async () => {
    const page = await sharedContext.newPage()
    try {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Use post 14 to avoid conflicts
      const voteButton = page.getByTestId('vote-button').nth(14)
      await expect(voteButton).toBeVisible({ timeout: 10000 })

      // Normalise to unvoted state
      const isVoted = await voteButton.evaluate((el) => el.classList.contains('post-card__vote--voted'))
      if (isVoted) {
        await voteButton.click()
        await expect(voteButton).not.toHaveClass(/post-card__vote--voted/, { timeout: 5000 })
        await page.waitForLoadState('networkidle')
      }

      // Vote
      await voteButton.click()
      await expect(voteButton).toHaveClass(/post-card__vote--voted/, { timeout: 5000 })

      // Navigate away to a different page then come back
      await page.goto('/admin/feedback')
      await page.waitForLoadState('networkidle')
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // The vote should still be reflected (button shows voted state)
      const returnedButton = page.getByTestId('vote-button').nth(14)
      await expect(returnedButton).toBeVisible({ timeout: 10000 })
      await expect(returnedButton).toHaveClass(/post-card__vote--voted/, { timeout: 5000 })
    } finally {
      await page.close()
    }
  })

  test('vote count on post list matches vote count on post detail page', async () => {
    const page = await sharedContext.newPage()
    try {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Use post 15 to avoid conflicts
      const voteButtons = page.getByTestId('vote-button')
      await expect(voteButtons.first()).toBeVisible({ timeout: 10000 })

      const listVoteButton = voteButtons.nth(15)
      const listCountSpan = listVoteButton.getByTestId('vote-count')
      const listCount = await listCountSpan.textContent()

      // Find the post link in the same card and navigate to it
      const postLinks = page.locator('a[href*="/posts/"]')
      await postLinks.nth(15).click()
      await page.waitForURL(/\/posts\//)
      await page.waitForLoadState('networkidle')

      // Detail page vote button — use first vote button (VoteSidebar, in DOM order)
      const detailVoteButton = page.getByTestId('vote-button').first()
      await expect(detailVoteButton).toBeVisible({ timeout: 10000 })

      const detailCount = await detailVoteButton.getByTestId('vote-count').textContent()

      expect(detailCount).toBe(listCount)
    } finally {
      await page.close()
    }
  })
})

test.describe('Voting — debounce / rapid clicks', () => {
  test.setTimeout(60000)

  test('rapid clicks do not cause double-voting', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Use an anonymous session (no auth setup needed for this test)
    const voteButtons = page.getByTestId('vote-button')
    await expect(voteButtons.first()).toBeVisible({ timeout: 10000 })

    // Use post 16 — unlikely to conflict with authenticated tests above
    const voteButton = voteButtons.nth(16)
    const countSpan = voteButton.getByTestId('vote-count')

    // Normalise to unvoted
    const isVoted = await voteButton.evaluate((el) => el.classList.contains('post-card__vote--voted'))
    if (isVoted) {
      await voteButton.click()
      await expect(voteButton).not.toHaveClass(/post-card__vote--voted/, { timeout: 10000 })
      await page.waitForLoadState('networkidle')
    }

    const baseCount = parseInt((await countSpan.textContent()) || '0', 10)

    // Fire three rapid clicks — debounce/idempotency should result in net +1 or 0
    await voteButton.click()
    await voteButton.click()
    await voteButton.click()

    // After rapid clicks settle, count should not exceed baseCount + 1
    await page.waitForTimeout(1000)
    const finalText = await countSpan.textContent()
    const finalCount = parseInt(finalText || '0', 10)
    expect(finalCount).toBeLessThanOrEqual(baseCount + 1)
    expect(finalCount).toBeGreaterThanOrEqual(baseCount - 1)
  })
})

test.describe('Voting — filtered board context', () => {
  test.setTimeout(60000)

  test('voting on a post works when a board filter is active', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Click the first board filter tab if any exist
    const boardTabs = page.locator('[data-testid="board-tab"], button[data-board]')
    const tabCount = await boardTabs.count()

    if (tabCount > 0) {
      await boardTabs.first().click()
      await page.waitForLoadState('networkidle')
    } else {
      // No explicit board tabs — use URL query parameter for the first available board
      const firstBoardLink = page.locator('a[href*="?board="], a[href*="&board="]').first()
      if ((await firstBoardLink.count()) > 0) {
        await firstBoardLink.click()
        await page.waitForLoadState('networkidle')
      }
    }

    // After filtering, vote buttons should still be present and functional
    const filteredVoteButtons = page.getByTestId('vote-button')
    const hasButtons = (await filteredVoteButtons.count()) > 0

    if (!hasButtons) {
      // Board has no posts — nothing to vote on, test is vacuously satisfied
      return
    }

    const voteButton = filteredVoteButtons.first()
    const countSpan = voteButton.getByTestId('vote-count')

    // Normalise to unvoted
    const isVoted = await voteButton.evaluate((el) => el.classList.contains('post-card__vote--voted'))
    if (isVoted) {
      await voteButton.click()
      await expect(voteButton).not.toHaveClass(/post-card__vote--voted/, { timeout: 10000 })
      await page.waitForLoadState('networkidle')
    }

    const baseCount = parseInt((await countSpan.textContent()) || '0', 10)

    await voteButton.click()

    await expect(voteButton).toHaveClass(/post-card__vote--voted/, { timeout: 10000 })
    await expect(countSpan).toHaveText(String(baseCount + 1), { timeout: 10000 })
  })
})
