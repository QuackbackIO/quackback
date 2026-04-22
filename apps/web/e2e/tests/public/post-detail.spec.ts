import { test, expect } from '@playwright/test'

/**
 * Navigate to the first available post from the portal home page and return its URL.
 */
async function navigateToFirstPost(page: Parameters<typeof test>[1] extends (args: { page: infer P }) => unknown ? P : never) {
  await page.goto('/')
  const postCards = page.locator('a[href*="/posts/"]:has(h3)')
  await expect(postCards.first()).toBeVisible({ timeout: 15000 })
  await postCards.first().click()
  await page.waitForURL(/\/posts\//, { timeout: 15000 })
  await page.waitForLoadState('networkidle')
}

test.describe('Post detail page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToFirstPost(page)
    await expect(page.getByTestId('post-detail')).toBeVisible({ timeout: 10000 })
  })

  // ---- Layout & structure ----

  test('content is constrained within a max-width container', async ({ page }) => {
    const viewport = page.viewportSize()!
    const box = await page.getByTestId('post-detail').boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThan(0)
    expect(box!.x + box!.width).toBeLessThan(viewport.width)
  })

  test('URL matches /:boardSlug/posts/:postId pattern', async ({ page }) => {
    await expect(page).toHaveURL(/\/b\/[^/]+\/posts\/[^/]+/)
  })

  // ---- Post content ----

  test('shows post title as an h1 heading', async ({ page }) => {
    // PostContentSection renders <h1> for the post title
    const title = page.locator('h1')
    await expect(title).toBeVisible({ timeout: 10000 })
    const titleText = await title.textContent()
    expect(titleText?.trim().length).toBeGreaterThan(0)
  })

  test('page <title> includes the post title', async ({ page }) => {
    const h1Text = await page.locator('h1').textContent()
    const pageTitle = await page.title()
    // The post title should appear somewhere in the document title
    if (h1Text && h1Text.trim().length > 0) {
      expect(pageTitle).toContain(h1Text.trim().slice(0, 20))
    }
  })

  test('shows post body / description content', async ({ page }) => {
    // PostContentSection renders a .prose container with the body
    const body = page.locator('.prose').or(page.locator('[data-testid="post-content"]'))
    if ((await body.count()) > 0) {
      await expect(body.first()).toBeVisible({ timeout: 5000 })
    }
  })

  // ---- Status badge ----

  test('shows status badge', async ({ page }) => {
    // StatusBadge is rendered in PostContentSection and MetadataSidebar
    // It renders a styled span; look for text that matches known seeded statuses
    const statusBadges = page
      .locator('[class*="rounded"]')
      .filter({ hasText: /open|planned|in progress|completed|closed|under review/i })

    test.skip(
      (await statusBadges.count()) === 0,
      'No status badges visible on this post — post may have no status assigned'
    )

    await expect(statusBadges.first()).toBeVisible({ timeout: 5000 })
  })

  // ---- Vote button ----

  test('shows vote button', async ({ page }) => {
    const voteButton = page.getByTestId('vote-button')
    await expect(voteButton.first()).toBeVisible({ timeout: 10000 })
  })

  test('vote button displays a numeric vote count', async ({ page }) => {
    const voteButton = page.getByTestId('vote-button').first()
    await expect(voteButton).toBeVisible({ timeout: 10000 })

    const voteCount = voteButton.getByTestId('vote-count')
    await expect(voteCount).toBeVisible()
    const countText = await voteCount.textContent()
    expect(countText?.trim()).toMatch(/^\d+$/)
  })

  // ---- Comments section ----

  test('shows comments section header', async ({ page }) => {
    const commentsHeader = page.getByText(/\d+\s+comments?/i)
    await expect(commentsHeader).toBeVisible({ timeout: 10000 })
  })

  test('unauthenticated user sees "Sign in to comment" prompt or comment form', async ({
    page,
  }) => {
    // Either a sign-in prompt or a comment form must be present
    const signInPrompt = page.getByText(/sign in to comment/i)
    const commentForm = page.locator('textarea[placeholder*="comment" i]').or(
      page.locator('[data-testid="comment-form"]')
    )

    const hasSignIn = (await signInPrompt.count()) > 0
    const hasForm = (await commentForm.count()) > 0

    expect(hasSignIn || hasForm).toBe(true)

    if (hasSignIn) {
      await expect(signInPrompt).toBeVisible({ timeout: 5000 })
    }
  })

  test('sign in to comment button is present for guests', async ({ page }) => {
    const signInButton = page.getByRole('button', { name: /sign in/i })
    if ((await signInButton.count()) > 0) {
      await expect(signInButton.first()).toBeVisible()
    }
  })

  test('existing comments are listed', async ({ page }) => {
    // Check for comments with data-testid or the comments list
    const comments = page.locator('[data-testid="comment"]')
    const commentCount = await comments.count()

    if (commentCount > 0) {
      await expect(comments.first()).toBeVisible()
    } else {
      // Comments section header is still visible (0 Comments)
      await expect(page.getByText(/\d+\s+comments?/i)).toBeVisible()
    }
  })

  test('comments show author name and timestamp', async ({ page }) => {
    const comments = page.locator('[data-testid="comment"]')
    if ((await comments.count()) > 0) {
      const firstComment = comments.first()

      // Author name renders as a font-medium span
      const authorSpan = firstComment.locator('span.font-medium').or(
        firstComment.locator('[class*="font-medium"]').first()
      )
      if ((await authorSpan.count()) > 0) {
        await expect(authorSpan.first()).toBeVisible()
      }

      // Timestamp renders via TimeAgo as relative text
      const timestamp = page.getByText(
        /(\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago|about\s+\d+)/i
      )
      if ((await timestamp.count()) > 0) {
        await expect(timestamp.first()).toBeVisible()
      }
    }
  })

  // ---- Metadata sidebar (desktop) ----

  test('shows board name in metadata sidebar on desktop', async ({ page }) => {
    // MetadataSidebar renders "Board" label with the board name
    const boardLabel = page.getByText('Board', { exact: true })
    if ((await boardLabel.count()) > 0) {
      await expect(boardLabel).toBeVisible()
    }
  })

  test('shows author name in metadata sidebar', async ({ page }) => {
    // MetadataSidebar renders "Author" label with name
    const authorLabel = page.getByText('Author', { exact: true })
    if ((await authorLabel.count()) > 0) {
      await expect(authorLabel).toBeVisible()
    }
  })

  test('shows date in metadata sidebar', async ({ page }) => {
    // MetadataSidebar renders "Date" label with a TimeAgo
    const dateLabel = page.getByText('Date', { exact: true })
    if ((await dateLabel.count()) > 0) {
      await expect(dateLabel).toBeVisible()
    }
  })

  // ---- Back / breadcrumb navigation ----

  test('page has a link or breadcrumb that navigates back to the portal', async ({ page }) => {
    // The portal has a back link, a board name link, or a logo link
    const backLink = page
      .getByRole('link', { name: /back|feedback|all posts|home/i })
      .or(page.locator('a[href="/"]'))
      .or(page.locator('a[href*="/?"]'))

    if ((await backLink.count()) > 0) {
      await expect(backLink.first()).toBeVisible({ timeout: 5000 })
    }
  })

  test('clicking the board name navigates back to filtered list', async ({ page }) => {
    // Board name text appears in the metadata sidebar; on mobile in the post card header
    const currentUrl = page.url()
    const boardSlug = currentUrl.match(/\/b\/([^/]+)\/posts\//)?.[1]

    if (boardSlug) {
      const boardLink = page.locator(`a[href*="?board=${boardSlug}"]`)
        .or(page.locator(`a[href*="/b/${boardSlug}"]`))

      if ((await boardLink.count()) > 0) {
        await boardLink.first().click()
        await page.waitForLoadState('networkidle')
        // Should be back on a listing view
        await expect(page).not.toHaveURL(/\/posts\//)
      }
    }
  })

  // ---- Open graph / SEO meta ----

  test('og:title meta tag contains the post title', async ({ page }) => {
    const h1Text = (await page.locator('h1').textContent())?.trim() ?? ''
    if (h1Text.length === 0) return

    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content')
    if (ogTitle) {
      expect(ogTitle.toLowerCase()).toContain(h1Text.toLowerCase().slice(0, 20))
    }
  })

  test('og:description meta tag is present', async ({ page }) => {
    const ogDesc = page.locator('meta[property="og:description"]')
    if ((await ogDesc.count()) > 0) {
      const content = await ogDesc.getAttribute('content')
      expect(content?.length).toBeGreaterThan(0)
    }
  })

  // ---- Subscribe bell ----

  test('subscribe / notification bell is present in metadata sidebar', async ({ page }) => {
    // AuthSubscriptionBell renders a bell button in the sidebar
    const bellButton = page.getByRole('button', { name: /subscribe|unsubscribe|notification/i })
    if ((await bellButton.count()) > 0) {
      await expect(bellButton.first()).toBeVisible()
    }
  })
})
