/**
 * E2E: @-mention happy path
 *
 * Covers the full TipTap mention loop that landed across Tasks 1-18:
 *   1. Demo admin opens the portal post-submission form
 *   2. Types `@<prefix>` in the body → MentionPicker shows the target user
 *   3. Picks the target → an in-editor `.mention[data-id]` chip is inserted
 *   4. Submits the post → it lands in the feed
 *   5. Opening the post renders the chip as `.mention[data-principal-id="..."]`
 *   6. Hovering the chip triggers the hover-card overlay with the target's
 *      displayName
 *
 * Auth: this spec runs under the `chromium` project which loads the demo
 * admin session from `e2e/.auth/admin.json`. The portal lives at the
 * same host as /admin so the session cookie is sent to both surfaces.
 *
 * Skipped: notification-inbox + email assertions. The seed only credentials
 * the demo user (no password / magic-link inbox for `user1..30@example.com`),
 * so we can't log in as the mentioned user without a second auth seam. The
 * unit tests in `targets-mention.test.ts` + `post.service-mentions.test.ts`
 * cover the event dispatch + notification/email targeting; the chip + hover
 * card are the load-bearing UI behaviours this e2e protects.
 */
import { test, expect } from '@playwright/test'
import { getMentionTarget } from '../../utils/db-helpers'

test.describe.configure({ mode: 'serial' })

test.describe('Post @-mention happy path', () => {
  test.setTimeout(90000)

  test('admin can mention a user, save the post, and see a hover card on the rendered chip', async ({
    page,
  }) => {
    // ---- Seed lookup -------------------------------------------------------
    // Seed display names are randomised per `bun run db:seed`, so resolve the
    // target principalId + name at test time. Skip the demo user (we ARE the
    // demo user) and the seed's anonymous principals.
    const target = getMentionTarget('demo@example.com')
    // TypeID form: `principal_<26 base32 chars>`. The mention API + chip
    // attrs all use this form, never the raw UUID.
    expect(target.principalId).toMatch(/^principal_[0-9a-z]+$/)
    expect(target.displayName.length).toBeGreaterThan(2)
    // Prefix LIKE on lower(displayName) — first three chars is the minimum
    // useful query (debounced fetch, server side limit 10).
    const queryPrefix = target.displayName.slice(0, 3)

    // ---- Open the portal post form ----------------------------------------
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const createPostInput = page.getByPlaceholder("What's your idea?")
    await expect(createPostInput).toBeVisible({ timeout: 15000 })
    await createPostInput.click()

    const uniqueTitle = `Mention E2E ${Date.now()}`
    await createPostInput.fill(uniqueTitle)

    const editor = page.locator('.tiptap')
    await expect(editor).toBeVisible({ timeout: 10000 })

    // ---- Type @prefix and wait for the MentionPicker ----------------------
    // The mention extension debounces the suggest fetch by 200ms — wait for
    // the actual API response so we don't race the picker render.
    await editor.click()
    // Track every suggest response that comes back while typing so we know
    // both that the API was called *and* what it returned. Multiple
    // responses arrive (one per typed char after the 200ms debounce
    // collapses); we just need at least one with our target in it.
    const suggestResponses: Array<{ url: string; bodyText: string }> = []
    page.on('response', async (resp) => {
      if (!resp.url().includes('/api/v1/mentions/suggest')) return
      try {
        suggestResponses.push({ url: resp.url(), bodyText: await resp.text() })
      } catch {
        // ignore body-read races during navigation
      }
    })
    // keyboard.type fires one DOM keystroke per char so each one is seen by
    // the TipTap suggestion plugin. A single .fill() would short-circuit
    // that and bypass the typeahead entirely.
    //
    // The delay (260ms) is intentionally larger than the extension's 200ms
    // debounce: @tiptap/suggestion awaits the `items()` promise BEFORE
    // calling `onStart`, and the extension's items() returns a Promise that
    // only resolves after the 200ms debounce. If we typed faster, each
    // keystroke would clearTimeout the previous timer, leaving the awaited
    // promise un-resolved, and the picker would never render. Typing slower
    // gives each promise time to resolve cleanly.
    await page.keyboard.type(`@${queryPrefix}`, { delay: 260 })

    // Tippy renders the picker into document.body inside a `.tippy-box`.
    // Wait for the inner `.mention-picker` to settle: the suggestion is
    // debounced 200ms, the React commit + tippy positioning add a few more.
    // 8s gives us plenty of headroom on slow CI runners.
    const picker = page.locator('.tippy-box .mention-picker').first()
    try {
      await expect(picker).toBeVisible({ timeout: 8000 })
    } catch (err) {
      // Surface what the server gave us so the failure is debuggable from
      // the CI log instead of a bare locator-timeout message.
      console.log('[mentions-e2e] suggest responses observed:', suggestResponses)
      const bodyDump = await page.evaluate(() => ({
        tippyCount: document.querySelectorAll('.tippy-box').length,
        pickerCount: document.querySelectorAll('.mention-picker').length,
        editorText: document.querySelector('.ProseMirror')?.textContent ?? null,
        bodyChildrenAtEnd: Array.from(document.body.children)
          .slice(-5)
          .map((el) => `${el.tagName}.${el.className}`),
      }))
      console.log('[mentions-e2e] DOM dump:', bodyDump)
      throw err
    }

    // The picker must include our target. Use a regex to allow other matches
    // before/after — we just need to confirm the target shows up.
    const targetRow = picker.locator('.mention-picker__row').filter({ hasText: target.displayName })
    await expect(targetRow.first()).toBeVisible({ timeout: 5000 })

    // ---- Select the target via Enter --------------------------------------
    // The picker has roving selection starting at index 0. For determinism,
    // click the target row directly (avoids ordering surprises if the
    // alphabetical first match isn't our target).
    await targetRow.first().click()

    // ---- Verify the in-editor chip ----------------------------------------
    // TipTap renders the mention as <span class="mention" data-id="<uuid>"
    // data-label="<name>" data-type="mention">@<name></span>
    const editorChip = page.locator(`.ProseMirror .mention[data-id="${target.principalId}"]`)
    await expect(editorChip).toBeVisible({ timeout: 5000 })
    await expect(editorChip).toHaveAttribute('data-label', target.displayName)
    await expect(editorChip).toContainText(`@${target.displayName}`)

    // ---- Submit -----------------------------------------------------------
    // Wait for the create-post mutation (server function) to settle. The
    // form's `useCreatePublicPost` posts to the TanStack-Start server fn,
    // so we just wait for the editor to collapse — same signal the
    // post-submission spec uses.
    const submitBtn = page.getByRole('button', { name: /^submit$/i })
    await submitBtn.click()
    await expect(editor).not.toBeVisible({ timeout: 15000 })

    // ---- Navigate to the new post ----------------------------------------
    // Toast offers a "View" action; using the heading link is more robust
    // because the toast may auto-dismiss between assertions.
    await page
      .getByRole('button', { name: /^New$/i })
      .click()
      .catch(() => {
        // Sort-by-new is best-effort: if "New" isn't visible (e.g. layout
        // variant) the cache-updated list still surfaces the post.
      })
    const postLink = page.locator(`a[href*="/posts/"]:has(h3:text("${uniqueTitle}"))`)
    await expect(postLink.first()).toBeVisible({ timeout: 15000 })
    await postLink.first().click()
    await page.waitForURL(/\/posts\//, { timeout: 10000 })
    await page.waitForLoadState('networkidle')

    // ---- Verify the rendered chip ---------------------------------------
    // Rendered HTML uses data-principal-id (not data-id) — see
    // rich-text-editor.tsx#generateContentHTML mention case.
    const renderedChip = page.locator(`.mention[data-principal-id="${target.principalId}"]`).first()
    await expect(renderedChip).toBeVisible({ timeout: 10000 })
    await expect(renderedChip).toHaveAttribute('data-display-name', target.displayName)
    await expect(renderedChip).toContainText(`@${target.displayName}`)

    // ---- Hover the chip → hover card appears -----------------------------
    // MentionHoverCardOverlay uses event delegation (mouseenter capture) and
    // a 150ms open delay before showing. The popover content lives on a
    // Radix Popover anchored to a fixed-position ghost element.
    const cardRequest = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/v1/users/${target.principalId}/card`) && resp.status() === 200,
      { timeout: 10000 }
    )
    await renderedChip.hover()
    await cardRequest

    const popover = page.locator('[data-slot="popover-content"]')
    await expect(popover).toBeVisible({ timeout: 5000 })
    await expect(popover).toContainText(target.displayName)
  })
})
