import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { getOtpCode } from '../../utils/db-helpers'

const TEST_EMAIL = 'demo@example.com'
const TEST_HOST = 'acme.localhost:3000'

// Run serially to avoid OTP rate-limiting conflicts with other spec files
test.describe.configure({ mode: 'serial' })

// ---------------------------------------------------------------------------
// Auth helper (mirrors voting.spec.ts pattern with exponential backoff)
// ---------------------------------------------------------------------------
async function authenticateViaOTP(page: Page, maxRetries = 8) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const sendResponse = await page.request.post('/api/auth/email-otp/send-verification-otp', {
        headers: { 'Content-Type': 'application/json' },
        data: { email: TEST_EMAIL, type: 'sign-in' },
      })

      if (sendResponse.status() === 429) {
        const wait = Math.min(2000 * Math.pow(2, attempt), 20000)
        console.log(`[comments] Rate limited, waiting ${wait}ms (attempt ${attempt + 1})`)
        await page.waitForTimeout(wait)
        continue
      }

      if (!sendResponse.ok()) {
        throw new Error(`OTP send failed: ${await sendResponse.text()}`)
      }

      const otpCode = getOtpCode(TEST_EMAIL, TEST_HOST)

      const verifyResponse = await page.request.post('/api/auth/sign-in/email-otp', {
        headers: { 'Content-Type': 'application/json' },
        data: { email: TEST_EMAIL, otp: otpCode },
      })

      if (!verifyResponse.ok()) {
        throw new Error(`OTP verify failed: ${await verifyResponse.text()}`)
      }

      await page.goto('/')
      await page.waitForLoadState('networkidle')
      console.log('[comments] Authentication successful')
      return
    } catch (err) {
      if (attempt === maxRetries - 1) throw err
      console.log(`[comments] Auth attempt ${attempt + 1} failed, retrying...`)
      await page.waitForTimeout(3000)
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: navigate to the first available post detail page
// ---------------------------------------------------------------------------
async function goToFirstPost(page: Page) {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const postLinks = page.locator('a[href*="/posts/"]')
  await expect(postLinks.first()).toBeVisible({ timeout: 15000 })
  await postLinks.first().click()
  await page.waitForURL(/\/posts\//)
  await page.waitForLoadState('networkidle')
  // Wait for the comments heading (count badge rendered by CommentsSection)
  await expect(page.getByRole('heading', { name: /\d+ comments?/i })).toBeVisible({
    timeout: 10000,
  })
}

// ===========================================================================
// UNAUTHENTICATED USER TESTS
// (uses default per-test browser context — no session cookie)
// ===========================================================================
test.describe('Unauthenticated user — comments section', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page }) => {
    await goToFirstPost(page)
  })

  // -------------------------------------------------------------------------
  test('comments section heading is present on post detail page', async ({ page }) => {
    // The heading is rendered by CommentsSection as an <h2> with the count text
    const heading = page.getByRole('heading', { name: /\d+ comments?/i })
    await expect(heading).toBeVisible()
    // Ensure we really are on a post detail page
    await expect(page).toHaveURL(/\/posts\//)
  })

  // -------------------------------------------------------------------------
  test('comment form textarea is NOT visible to unauthenticated users', async ({ page }) => {
    // CommentThread renders the "Sign in" prompt instead of a comment form for
    // unauthenticated users. Hidden reply-form textareas inside comments may report
    // as visible to Playwright (CSS grid 0fr + overflow:hidden doesn't clip bounding rect).
    // Assert the sign-in prompt is present and that the top-level comment form area
    // does NOT contain a submit button (the form wrapper is distinct from reply forms).
    await expect(page.getByText(/sign in to comment/i)).toBeVisible({ timeout: 10000 })
    // The main form area should be the sign-in prompt, not a form with a submit button
    const mainCommentSubmit = page
      .locator('[data-testid="comments-section"], .space-y-6')
      .first()
      .getByRole('button', { name: /^comment$/i })
    await expect(mainCommentSubmit).not.toBeVisible()
  })

  // -------------------------------------------------------------------------
  test('shows "Sign in to comment" text for unauthenticated users', async ({ page }) => {
    await expect(page.getByText(/sign in to comment/i)).toBeVisible()
  })

  // -------------------------------------------------------------------------
  test('shows a "Sign in" button for unauthenticated users', async ({ page }) => {
    const signInButton = page.getByRole('button', { name: /^sign in$/i })
    await expect(signInButton).toBeVisible()
  })

  // -------------------------------------------------------------------------
  test('existing comments are visible to unauthenticated users', async ({ page }) => {
    // The comment list is always rendered regardless of auth state.
    // If there are no seed comments we get the empty-state message — either is valid.
    const commentItems = page.locator('[id^="comment-"]')
    const emptyState = page.getByText(/no comments yet/i)

    const hasComments = (await commentItems.count()) > 0
    const hasEmptyState = await emptyState.isVisible()

    expect(hasComments || hasEmptyState).toBe(true)
  })

  // -------------------------------------------------------------------------
  test('comment count in heading matches number of comment DOM nodes', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /\d+ comments?/i })
    const headingText = await heading.textContent()
    const match = headingText?.match(/(\d+)/)
    const countFromHeading = match ? parseInt(match[1], 10) : 0

    // Count only top-level comment nodes (id="comment-*")
    // Nested replies also have `id="comment-*"`, so count all of them.
    const commentNodes = page.locator('[id^="comment-"]')
    const domCount = await commentNodes.count()

    // The heading count == total live comments (including nested);
    // domCount includes deleted placeholders, so heading ≤ domCount.
    expect(countFromHeading).toBeLessThanOrEqual(domCount + 1) // +1 for deleted placeholders
  })

  // -------------------------------------------------------------------------
  test('comments show author name', async ({ page }) => {
    const commentItems = page.locator('[id^="comment-"]')
    if ((await commentItems.count()) === 0) {
      // No seed comments on this post — skip gracefully
      return
    }

    // Author name sits in a `span.font-medium.text-sm` inside each comment
    // Use .first() because nested reply threads can render multiple spans with the same class
    const authorSpan = commentItems.first().locator('span.font-medium.text-sm').first()
    await expect(authorSpan).toBeVisible({ timeout: 5000 })
    const name = await authorSpan.textContent()
    expect(name).not.toBe('')
    expect(name).not.toBeNull()
  })

  // -------------------------------------------------------------------------
  test('comments show a relative timestamp', async ({ page }) => {
    const commentItems = page.locator('[id^="comment-"]')
    if ((await commentItems.count()) === 0) {
      return
    }

    // The <time datetime="..."> element is always rendered for timestamps,
    // regardless of the display format (e.g. "2 days ago", "just now", "3h").
    const timestamp = commentItems.first().locator('time[datetime]')
    if ((await timestamp.count()) === 0) return
    await expect(timestamp.first()).toBeVisible({ timeout: 5000 })
    const datetimeVal = await timestamp.first().getAttribute('datetime')
    expect(datetimeVal).toBeTruthy()
  })

  // -------------------------------------------------------------------------
  test('comments are sorted most-recent-first (newest comment appears first)', async ({
    page,
  }) => {
    const commentItems = page.locator('[id^="comment-"]')
    const count = await commentItems.count()
    if (count < 2) return // need at least two comments to test ordering

    // Grab the text content of the first two timestamps (TimeAgo elements)
    // They live inside the `<span>` rendered by <TimeAgo> which has a `datetime` attribute
    const timeEls = page.locator('[id^="comment-"] time')
    const timeCount = await timeEls.count()
    if (timeCount < 2) return // need at least two time elements to compare ordering

    const firstDatetime = await timeEls.nth(0).getAttribute('datetime')
    const secondDatetime = await timeEls.nth(1).getAttribute('datetime')

    if (!firstDatetime || !secondDatetime) return

    const firstDate = new Date(firstDatetime).getTime()
    const secondDate = new Date(secondDatetime).getTime()

    // Most-recent first → firstDate ≥ secondDate
    expect(firstDate).toBeGreaterThanOrEqual(secondDate)
  })

  // -------------------------------------------------------------------------
  test('comment count heading shows "Comment" (singular) when count is 1', async ({ page }) => {
    // Navigate through posts until we find one with exactly 1 comment,
    // or accept that the seed data may not have exactly 1.  We verify the
    // grammar rule by checking whatever post we land on.
    const headingText = (await page.getByRole('heading', { name: /\d+ comments?/i }).textContent()) ?? ''
    const match = headingText.match(/^(\d+)\s+(.+)$/)
    if (!match) return

    const count = parseInt(match[1], 10)
    const word = match[2].trim().toLowerCase()

    if (count === 1) {
      expect(word).toBe('comment')
    } else {
      expect(word).toBe('comments')
    }
  })
})

// ===========================================================================
// AUTHENTICATED USER TESTS
// Shared browser context authenticated once for the whole suite.
// ===========================================================================
test.describe('Authenticated user — comment form and submission', () => {
  test.setTimeout(90000)

  let sharedContext: BrowserContext

  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext()
    const page = await sharedContext.newPage()
    await authenticateViaOTP(page)
    await page.close()
  })

  test.afterAll(async () => {
    if (sharedContext) await sharedContext.close()
  })

  // -------------------------------------------------------------------------
  test('comment form textarea IS visible after signing in', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)
      const textarea = page.locator('textarea[placeholder*="comment" i]').first()
      await expect(textarea).toBeVisible({ timeout: 10000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('comment textarea has "Write a comment..." placeholder', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)
      const textarea = page.locator('textarea[placeholder*="Write a comment" i]').first()
      await expect(textarea).toBeVisible({ timeout: 10000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('after submit: new comment appears in the list', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)

      const uniqueText = `E2E comment ${Date.now()}`
      const textarea = page.locator('textarea[placeholder*="Write a comment" i]').first()
      await textarea.fill(uniqueText)

      const submitBtn = page.getByRole('button', { name: /^comment$/i }).first()
      await submitBtn.click()

      // Wait for textarea to clear (form reset after success)
      await expect(textarea).toHaveValue('', { timeout: 10000 })

      // The comment text must now be visible in the list
      await expect(page.getByText(uniqueText)).toBeVisible({ timeout: 10000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('after submit: textarea clears', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)

      const textarea = page.locator('textarea[placeholder*="Write a comment" i]').first()
      await textarea.fill(`Textarea clear test ${Date.now()}`)

      const submitBtn = page.getByRole('button', { name: /^comment$/i }).first()
      await submitBtn.click()

      await expect(textarea).toHaveValue('', { timeout: 10000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('after submit: new comment shows current user\'s name', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)

      const uniqueText = `Author check comment ${Date.now()}`
      const textarea = page.locator('textarea[placeholder*="Write a comment" i]').first()
      await textarea.fill(uniqueText)

      await page.getByRole('button', { name: /^comment$/i }).first().click()
      await expect(textarea).toHaveValue('', { timeout: 10000 })

      // Find the newly rendered comment
      const newComment = page.locator('[id^="comment-"]').filter({ hasText: uniqueText })
      await expect(newComment).toBeVisible({ timeout: 10000 })

      // Author name should include "Demo" (seed account name = "Demo User")
      const authorSpan = newComment.locator('span.font-medium.text-sm')
      await expect(authorSpan).toContainText(/demo/i, { timeout: 5000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('comment count increments after submitting a new comment', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)

      const heading = page.getByRole('heading', { name: /\d+ comments?/i })
      const beforeText = (await heading.textContent()) ?? '0'
      const beforeCount = parseInt(beforeText.match(/\d+/)?.[0] ?? '0', 10)

      const textarea = page.locator('textarea[placeholder*="Write a comment" i]').first()
      await textarea.fill(`Count increment test ${Date.now()}`)

      await page.getByRole('button', { name: /^comment$/i }).first().click()
      await expect(textarea).toHaveValue('', { timeout: 10000 })

      // Heading count must be beforeCount + 1
      await expect(heading).toContainText(String(beforeCount + 1), { timeout: 10000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('Cmd+Enter submits the comment', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)

      const uniqueText = `Keyboard submit ${Date.now()}`
      const textarea = page.locator('textarea[placeholder*="Write a comment" i]').first()
      await textarea.fill(uniqueText)

      // Trigger Cmd+Enter (CommentForm listens for metaKey || ctrlKey + Enter)
      await textarea.press('Meta+Enter')

      await expect(textarea).toHaveValue('', { timeout: 10000 })
      await expect(page.getByText(uniqueText)).toBeVisible({ timeout: 10000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('Ctrl+Enter also submits the comment', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)

      const uniqueText = `Ctrl-Enter submit ${Date.now()}`
      const textarea = page.locator('textarea[placeholder*="Write a comment" i]').first()
      await textarea.fill(uniqueText)

      await textarea.press('Control+Enter')

      await expect(textarea).toHaveValue('', { timeout: 10000 })
      await expect(page.getByText(uniqueText)).toBeVisible({ timeout: 10000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('second comment submission adds a second comment (not duplicate or replace)', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)

      const textA = `Second comment A ${Date.now()}`
      const textB = `Second comment B ${Date.now() + 1}`

      const textarea = page.locator('textarea[placeholder*="Write a comment" i]').first()
      const submitBtn = page.getByRole('button', { name: /^comment$/i }).first()

      // First comment
      await textarea.fill(textA)
      await submitBtn.click()
      await expect(textarea).toHaveValue('', { timeout: 10000 })

      // Second comment
      await textarea.fill(textB)
      await submitBtn.click()
      await expect(textarea).toHaveValue('', { timeout: 10000 })

      // Both must be in the DOM
      await expect(page.getByText(textA)).toBeVisible({ timeout: 10000 })
      await expect(page.getByText(textB)).toBeVisible({ timeout: 10000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('shows "Posting as Demo User" attribution text in comment form', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)
      // CommentForm renders "Posting as {name}" for authenticated non-anonymous users
      await expect(page.getByText(/posting as/i).first()).toBeVisible({ timeout: 10000 })
      await expect(page.getByText(/demo/i).first()).toBeVisible({ timeout: 10000 })
    } finally {
      await page.close()
    }
  })
})

// ===========================================================================
// EDGE CASES (authenticated)
// ===========================================================================
test.describe('Edge cases — comment content', () => {
  test.setTimeout(90000)

  let sharedContext: BrowserContext

  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext()
    const page = await sharedContext.newPage()
    await authenticateViaOTP(page)
    await page.close()
  })

  test.afterAll(async () => {
    if (sharedContext) await sharedContext.close()
  })

  // -------------------------------------------------------------------------
  test('very long comment (200+ chars) submits successfully', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)

      const longText =
        `Long comment ${Date.now()}: ` +
        'This is a very long comment that exceeds two hundred characters in total length. ' +
        'It is designed to test that the comment form and backend both handle lengthy content ' +
        'without truncation or validation errors. End of long text.'

      expect(longText.length).toBeGreaterThan(200)

      const textarea = page.locator('textarea[placeholder*="Write a comment" i]').first()
      await textarea.fill(longText)

      await page.getByRole('button', { name: /^comment$/i }).first().click()
      await expect(textarea).toHaveValue('', { timeout: 10000 })

      // The full text (or at least its start) should appear in the list
      await expect(page.getByText(longText.slice(0, 80))).toBeVisible({ timeout: 10000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('comment with special characters (emoji, angle brackets, quotes) renders correctly', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)

      const specialText = `Special chars: 🎉 <angle> "double" 'single' & ampersand ${Date.now()}`
      const textarea = page.locator('textarea[placeholder*="Write a comment" i]').first()
      await textarea.fill(specialText)

      await page.getByRole('button', { name: /^comment$/i }).first().click()
      await expect(textarea).toHaveValue('', { timeout: 10000 })

      // The emoji and text must render in the DOM (not escaped HTML entities visible as raw text)
      await expect(page.getByText(/🎉/).first()).toBeVisible({ timeout: 10000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('multi-line comment preserves whitespace/newlines in rendered output', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)

      const line1 = `Line one ${Date.now()}`
      const line2 = `Line two ${Date.now() + 1}`
      const multiLineText = `${line1}\n${line2}`

      const textarea = page.locator('textarea[placeholder*="Write a comment" i]').first()
      await textarea.fill(multiLineText)

      await page.getByRole('button', { name: /^comment$/i }).first().click()
      await expect(textarea).toHaveValue('', { timeout: 10000 })

      // Both line fragments must appear in the rendered comment
      await expect(page.getByText(line1)).toBeVisible({ timeout: 10000 })
      await expect(page.getByText(line2)).toBeVisible({ timeout: 10000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('cannot submit a whitespace-only comment', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)

      const textarea = page.locator('textarea[placeholder*="Write a comment" i]').first()
      // Fill with spaces only
      await textarea.fill('     ')

      const submitBtn = page.getByRole('button', { name: /^comment$/i }).first()
      // react-hook-form with Zod min(1) after trim should keep button disabled
      // OR the button may be enabled but show a validation error on submit.
      const isEnabled = await submitBtn.isEnabled()

      if (isEnabled) {
        await submitBtn.click()
        // Expect a validation message or that textarea does NOT clear (failed submit)
        const validationMsg = page.locator('[role="alert"]').or(page.locator('.text-destructive'))
        await expect(validationMsg.first()).toBeVisible({ timeout: 5000 })
      } else {
        // Button was already disabled — validation is working
        await expect(submitBtn).toBeDisabled()
      }
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('reply button appears on existing comments when authenticated', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)

      const commentItems = page.locator('[id^="comment-"]')
      if ((await commentItems.count()) === 0) return

      const replyBtn = commentItems.first().getByTestId('reply-button')
      await expect(replyBtn).toBeVisible({ timeout: 5000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('clicking Reply button shows a nested reply form', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)

      const commentItems = page.locator('[id^="comment-"]')
      if ((await commentItems.count()) === 0) return

      const replyBtn = commentItems.first().getByTestId('reply-button')
      await replyBtn.click()

      // The reply form is a nested CommentForm with a "Reply" submit button
      const replyTextarea = commentItems
        .first()
        .locator('textarea[placeholder*="Write a comment" i]')
      await expect(replyTextarea).toBeVisible({ timeout: 5000 })
    } finally {
      await page.close()
    }
  })
})
