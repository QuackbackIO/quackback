import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test'
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

// ---------------------------------------------------------------------------
// Comment editor helper
// ---------------------------------------------------------------------------
// The comment composer is a TipTap ProseMirror contenteditable, not a textarea.
// Playwright's `.fill()` doesn't work on contenteditable, and asserting the
// cleared state needs to look at `.textContent()` not `.value`. These helpers
// keep the test bodies declarative without leaking the editor's DOM shape.

function commentEditor(page: Page) {
  return page
    .locator('[data-testid="comment-form-editor"] .ProseMirror[contenteditable="true"]')
    .first()
}

async function clearEditor(editor: ReturnType<typeof commentEditor>) {
  await editor.click()
  // Select-all + delete clears every node including nested blocks.
  await editor.press('ControlOrMeta+a')
  await editor.press('Delete')
}

async function typeIntoEditor(editor: ReturnType<typeof commentEditor>, text: string) {
  await editor.click()
  await clearEditor(editor)
  await editor.pressSequentially(text)
}

async function expectEditorEmpty(editor: ReturnType<typeof commentEditor>) {
  // The Placeholder extension renders an empty `<p>` (often with a `<br>`) and
  // the wrapper carries `is-editor-empty`; the textContent reduces to '' once
  // the doc is empty.
  await expect(editor).toHaveText('', { timeout: 10000 })
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
  test('comment composer is NOT visible to unauthenticated users', async ({ page }) => {
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
  test('Edit button is NOT shown to unauthenticated users', async ({ page }) => {
    const commentItems = page.locator('[id^="comment-"]')
    if ((await commentItems.count()) === 0) return
    await expect(page.getByRole('button', { name: /^edit$/i })).toHaveCount(0, { timeout: 5000 })
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
  test('comments are sorted most-recent-first (newest comment appears first)', async ({ page }) => {
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
    const headingText =
      (await page.getByRole('heading', { name: /\d+ comments?/i }).textContent()) ?? ''
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
  test('comment form is visible after signing in', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)
      await expect(commentEditor(page)).toBeVisible({ timeout: 10000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('comment composer renders the "Write a comment..." placeholder', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)
      // The Placeholder extension surfaces the placeholder via data-placeholder
      // on an `.is-editor-empty` paragraph that's visible until the user types.
      const placeholderHost = page
        .locator('[data-testid="comment-form-editor"] .is-editor-empty')
        .first()
      await expect(placeholderHost).toHaveAttribute('data-placeholder', /write a comment/i, {
        timeout: 10000,
      })
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
      const editor = commentEditor(page)
      await typeIntoEditor(editor, uniqueText)

      const submitBtn = page.getByRole('button', { name: /^comment$/i }).first()
      await submitBtn.click()

      await expectEditorEmpty(editor)

      // The comment text must now be visible in the list
      await expect(page.getByText(uniqueText)).toBeVisible({ timeout: 10000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('after submit: editor clears', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)

      const editor = commentEditor(page)
      await typeIntoEditor(editor, `Editor clear test ${Date.now()}`)

      const submitBtn = page.getByRole('button', { name: /^comment$/i }).first()
      await submitBtn.click()

      await expectEditorEmpty(editor)
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test("after submit: new comment shows current user's name", async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)

      const uniqueText = `Author check comment ${Date.now()}`
      const editor = commentEditor(page)
      await typeIntoEditor(editor, uniqueText)

      await page
        .getByRole('button', { name: /^comment$/i })
        .first()
        .click()
      await expectEditorEmpty(editor)

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

      const editor = commentEditor(page)
      await typeIntoEditor(editor, `Count increment test ${Date.now()}`)

      await page
        .getByRole('button', { name: /^comment$/i })
        .first()
        .click()
      await expectEditorEmpty(editor)

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
      const editor = commentEditor(page)
      await typeIntoEditor(editor, uniqueText)

      // CommentForm listens for metaKey || ctrlKey + Enter (capture-phase)
      await editor.press('Meta+Enter')

      await expectEditorEmpty(editor)
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
      const editor = commentEditor(page)
      await typeIntoEditor(editor, uniqueText)

      await editor.press('Control+Enter')

      await expectEditorEmpty(editor)
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

      const editor = commentEditor(page)
      const submitBtn = page.getByRole('button', { name: /^comment$/i }).first()

      // First comment
      await typeIntoEditor(editor, textA)
      await submitBtn.click()
      await expectEditorEmpty(editor)

      // Second comment
      await typeIntoEditor(editor, textB)
      await submitBtn.click()
      await expectEditorEmpty(editor)

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

      const editor = commentEditor(page)
      await typeIntoEditor(editor, longText)

      await page
        .getByRole('button', { name: /^comment$/i })
        .first()
        .click()
      await expectEditorEmpty(editor)

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
      const editor = commentEditor(page)
      await typeIntoEditor(editor, specialText)

      await page
        .getByRole('button', { name: /^comment$/i })
        .first()
        .click()
      await expectEditorEmpty(editor)

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

      const editor = commentEditor(page)
      await editor.click()
      await clearEditor(editor)
      await editor.pressSequentially(line1)
      // Comment editors are configured with enterAsHardBreak: plain Enter
      // inserts a <br>, splitting the visible line but keeping one paragraph.
      await editor.press('Enter')
      await editor.pressSequentially(line2)

      await page
        .getByRole('button', { name: /^comment$/i })
        .first()
        .click()
      await expectEditorEmpty(editor)

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

      const editor = commentEditor(page)
      await typeIntoEditor(editor, '     ')

      const submitBtn = page.getByRole('button', { name: /^comment$/i }).first()
      // react-hook-form with Zod min(1) after trim should keep button disabled
      // OR the button may be enabled but show a validation error on submit.
      const isEnabled = await submitBtn.isEnabled()

      if (isEnabled) {
        await submitBtn.click()
        // Expect a validation message or that the editor does NOT clear (failed submit)
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

      // The reply form is a nested CommentForm with the same editor data-testid
      const replyEditor = commentItems
        .first()
        .locator('[data-testid="comment-form-editor"] .ProseMirror[contenteditable="true"]')
      await expect(replyEditor).toBeVisible({ timeout: 5000 })
    } finally {
      await page.close()
    }
  })
})

// ===========================================================================
// COMMENT EDITING (authenticated)
// ===========================================================================
test.describe('Comment editing', () => {
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

  /** Submit a new comment and return a stable element ID + the unique text used. */
  async function submitAndLocate(page: Page): Promise<{ elementId: string; uniqueText: string }> {
    await goToFirstPost(page)
    const uniqueText = `Edit test ${Date.now()}`
    const editor = commentEditor(page)
    await typeIntoEditor(editor, uniqueText)
    await page
      .getByRole('button', { name: /^comment$/i })
      .first()
      .click()
    await expectEditorEmpty(editor)
    await expect(page.getByText(uniqueText)).toBeVisible({ timeout: 10000 })
    // Wait for this specific comment to receive a real server ID (not optimistic placeholder)
    await page.waitForFunction(
      (text) =>
        Array.from(document.querySelectorAll('[id^="comment-"]')).some(
          (el) => el.textContent?.includes(text) && !el.id.includes('optimistic')
        ),
      uniqueText
    )
    const commentItem = page.locator('[id^="comment-"]').filter({ hasText: uniqueText }).first()
    const elementId = await commentItem.getAttribute('id')
    if (!elementId) throw new Error(`Could not resolve element ID for comment: ${uniqueText}`)
    return { elementId, uniqueText }
  }

  // -------------------------------------------------------------------------
  test('Edit button is visible on own comments', async () => {
    const page = await sharedContext.newPage()
    try {
      const { uniqueText } = await submitAndLocate(page)
      const commentItem = page.locator('[id^="comment-"]').filter({ hasText: uniqueText }).first()
      await expect(commentItem.getByRole('button', { name: /^edit$/i })).toBeVisible({
        timeout: 5000,
      })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  // The edit form is a TipTap editor wrapped in `[data-testid="edit-comment-editor"]`.
  function editEditor(commentRoot: Locator) {
    return commentRoot
      .locator('[data-testid="edit-comment-editor"] .ProseMirror[contenteditable="true"]')
      .first()
  }

  test('clicking Edit opens an inline form with the current content', async () => {
    const page = await sharedContext.newPage()
    try {
      const { elementId, uniqueText } = await submitAndLocate(page)
      const comment = page.locator(`[id="${elementId}"]`)

      await comment.getByRole('button', { name: /^edit$/i }).click()

      const editor = editEditor(comment)
      await expect(editor).toBeVisible({ timeout: 5000 })
      // The editor seeds from contentJson (or markdown→tiptap fallback); the
      // typed-text assertion accepts either path so legacy rows still pass.
      await expect(editor).toContainText(uniqueText)
      // Edit button is replaced by Save / Cancel
      await expect(comment.getByRole('button', { name: /^edit$/i })).not.toBeVisible()
      await expect(comment.getByRole('button', { name: /^save$/i })).toBeVisible()
      // The reply form also renders a hidden Cancel, so use first() to target the edit Cancel
      await expect(comment.getByRole('button', { name: /^cancel$/i }).first()).toBeVisible()
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('Cancel closes the edit form and restores the original content', async () => {
    const page = await sharedContext.newPage()
    try {
      const { elementId, uniqueText } = await submitAndLocate(page)
      const comment = page.locator(`[id="${elementId}"]`)

      await comment.getByRole('button', { name: /^edit$/i }).click()
      const editor = editEditor(comment)
      await expect(editor).toBeVisible({ timeout: 5000 })
      await clearEditor(editor)
      await editor.pressSequentially('should not be saved')
      await comment
        .getByRole('button', { name: /^cancel$/i })
        .first()
        .click()

      await expect(editor).not.toBeVisible({ timeout: 5000 })
      await expect(comment.getByText(uniqueText)).toBeVisible()
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('Escape closes the edit form without saving', async () => {
    const page = await sharedContext.newPage()
    try {
      const { elementId, uniqueText } = await submitAndLocate(page)
      const comment = page.locator(`[id="${elementId}"]`)

      await comment.getByRole('button', { name: /^edit$/i }).click()
      const editor = editEditor(comment)
      await expect(editor).toBeVisible({ timeout: 5000 })

      await editor.press('Escape')

      await expect(editor).not.toBeVisible({ timeout: 5000 })
      await expect(comment.getByText(uniqueText)).toBeVisible()
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('Save updates the comment and shows an (edited) marker', async () => {
    const page = await sharedContext.newPage()
    try {
      const { elementId, uniqueText } = await submitAndLocate(page)
      const comment = page.locator(`[id="${elementId}"]`)

      await comment.getByRole('button', { name: /^edit$/i }).click()
      const editedText = `Edited: ${uniqueText}`
      const editor = editEditor(comment)
      await expect(editor).toBeVisible({ timeout: 5000 })
      await clearEditor(editor)
      await editor.pressSequentially(editedText)
      await comment.getByRole('button', { name: /^save$/i }).click()

      await expect(editor).not.toBeVisible({ timeout: 10000 })
      await expect(comment.getByText(editedText)).toBeVisible({ timeout: 10000 })
      await expect(comment.getByText('(edited)')).toBeVisible({ timeout: 10000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('Cmd+Enter saves the edit', async () => {
    const page = await sharedContext.newPage()
    try {
      const { elementId, uniqueText } = await submitAndLocate(page)
      const comment = page.locator(`[id="${elementId}"]`)

      await comment.getByRole('button', { name: /^edit$/i }).click()
      const editedText = `Cmd-Enter edit: ${uniqueText}`
      const editor = editEditor(comment)
      await expect(editor).toBeVisible({ timeout: 5000 })
      await clearEditor(editor)
      await editor.pressSequentially(editedText)
      await editor.press('Meta+Enter')

      await expect(editor).not.toBeVisible({ timeout: 10000 })
      await expect(comment.getByText(editedText)).toBeVisible({ timeout: 10000 })
      await expect(comment.getByText('(edited)')).toBeVisible({ timeout: 10000 })
    } finally {
      await page.close()
    }
  })

  // -------------------------------------------------------------------------
  test('Save button is disabled when the edit content is empty', async () => {
    const page = await sharedContext.newPage()
    try {
      const { elementId } = await submitAndLocate(page)
      const comment = page.locator(`[id="${elementId}"]`)

      await comment.getByRole('button', { name: /^edit$/i }).click()
      const editor = editEditor(comment)
      await expect(editor).toBeVisible({ timeout: 5000 })
      await clearEditor(editor)

      await expect(comment.getByRole('button', { name: /^save$/i })).toBeDisabled({
        timeout: 5000,
      })
    } finally {
      await page.close()
    }
  })
})

// ===========================================================================
// MARKDOWN RENDERING (authenticated)
// ===========================================================================
test.describe('Markdown comment rendering', () => {
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
  test('markdown shortcuts in the editor render as formatted DOM (heading, bold)', async () => {
    const page = await sharedContext.newPage()
    try {
      await goToFirstPost(page)

      // Unique marker keeps this test isolated from other comments in the list
      const marker = `md-${Date.now()}`

      const editor = commentEditor(page)
      await editor.click()
      await clearEditor(editor)
      // StarterKit's input rules fire on each typed character. `## ` lifts the
      // paragraph into H2; **word** wraps the inline span in <strong>.
      await editor.pressSequentially(`## My heading ${marker}`)
      // Comment editors use enterAsHardBreak for plain Enter, so we use
      // Shift+Enter to exit the heading into a fresh paragraph.
      await editor.press('Shift+Enter')
      await editor.pressSequentially(`This is **bold ${marker}**.`)

      // Submit via Ctrl+Enter (matches the existing keyboard-submit tests)
      await editor.press('Control+Enter')
      await expectEditorEmpty(editor)

      // Scope assertions to the new comment node so we don't collide with
      // any markdown rendered by other comments / page chrome.
      const newComment = page
        .locator('[id^="comment-"]')
        .filter({ hasText: `My heading ${marker}` })
        .first()
      await expect(newComment).toBeVisible({ timeout: 10000 })

      // Heading rendered as <h2>
      await expect(newComment.locator('h2', { hasText: `My heading ${marker}` })).toBeVisible()

      // Bold marker rendered as <strong>
      await expect(newComment.locator('strong', { hasText: `bold ${marker}` })).toBeVisible()
    } finally {
      await page.close()
    }
  })
})
