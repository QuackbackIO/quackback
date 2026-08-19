import { test, expect } from '@playwright/test'
import {
  setSupportSurfaces,
  seedConversation,
  type SeededConversation,
} from '../../utils/db-helpers'
import { waitForToast } from '../../utils/helpers'

/**
 * Characterization net for the admin support inbox (/admin/inbox), pinning
 * CURRENT behavior ahead of the thread-extraction refactor: list rendering,
 * thread open, agent reply, internal note, assignment, priority, status, and
 * the convert-to-post flow.
 *
 * The conversation is seeded directly in the DB (visitor = fresh anonymous
 * principal, channel 'messenger') so the spec has no cross-surface dependency
 * on the widget.
 */
test.describe('Admin Support Inbox', { tag: '@smoke' }, () => {
  // The Properties aside is `hidden xl:flex` (1280px). CI's default 1280
  // viewport can land just under that with chrome, so pin a desktop size.
  test.use({ viewport: { width: 1920, height: 1080 } })
  let seeded: SeededConversation

  test.beforeAll(() => {
    setSupportSurfaces(true)
    seeded = seedConversation(`E2E inbox conversation ${Date.now()}`)
  })

  test(
    'conversation lifecycle: list, thread, reply, note, triage, convert, snooze, close',
    {
      // List + reply + note + triage + convert + snooze + close is more than
      // the default 30s once the Note switcher is a dropdown extra click.
      timeout: 60_000,
    },
    async ({ page }) => {
      test.setTimeout(90_000)
      await page.goto('/admin/inbox')

      // The seeded conversation appears in the default (All / open) list - the
      // row shows the last-message preview.
      const row = page.getByText(seeded.messages[1]).first()
      await expect(row).toBeVisible({ timeout: 15000 })

      // Open the thread: the URL carries ?i=<conversationId> (`?c=` is a
      // legacy alias that validateSearch rewrites). The list is server-rendered
      // before React hydrates (and networkidle is unusable with SSE), so a
      // first click can land on inert HTML — retry until the selection reaches
      // the URL.
      await expect(async () => {
        await row.click()
        await expect(page).toHaveURL(new RegExp(`i=${seeded.conversationId}`), { timeout: 2000 })
      }).toPass({ timeout: 15000 })
      await expect(page.getByText(seeded.messages[0]).first()).toBeVisible({ timeout: 10000 })
      // The preview text now appears in both the list row and the thread.
      await expect(page.getByText(seeded.messages[1]).nth(1)).toBeVisible()

      // Triage controls live in the right-hand detail panel at this viewport
      // (1920px, xl+). The header carries hidden duplicates, so scope to the panel.
      const panel = page.getByRole('complementary', { name: 'Item details' })
      await expect(panel).toBeVisible()

      // A freshly seeded conversation is unassigned.
      await expect(panel.getByRole('button', { name: 'Unassigned' })).toBeVisible({
        timeout: 10000,
      })

      // Send a public reply. The composer is a TipTap editor; Enter sends, but
      // the explicit send button is more deterministic.
      const replyText = `Agent reply from e2e ${Date.now()}`
      const composer = page.locator('.ProseMirror[contenteditable="true"]')
      await composer.click()
      await composer.fill(replyText)
      await page.getByRole('button', { name: 'Send reply' }).click()
      await expect(page.getByText(replyText).first()).toBeVisible({ timeout: 10000 })

      // CURRENT BEHAVIOR: replying auto-claims an unassigned conversation for
      // the replying agent (the seed admin is named Demo User).
      await expect(panel.getByRole('button', { name: /Demo User/ })).toBeVisible({ timeout: 10000 })

      // Internal note: Reply vs Note is a composer dropdown (the trigger
      // reads the current mode), not a standalone toggle.
      await page.getByRole('button', { name: 'Reply', exact: true }).click()
      await page.getByRole('menuitemradio', { name: 'Note' }).click()
      const noteText = `Internal note from e2e ${Date.now()}`
      const noteComposer = page.locator('.ProseMirror[contenteditable="true"]')
      await noteComposer.click()
      await noteComposer.fill(noteText)
      await page.getByRole('button', { name: 'Add note' }).click()
      await expect(page.getByText(noteText).first()).toBeVisible({ timeout: 10000 })

      // Exercise the assignee control explicitly: unassign, then assign to self.
      await panel.getByRole('button', { name: /Demo User/ }).click()
      await page.getByRole('menuitem', { name: 'Unassign' }).click()
      await expect(panel.getByRole('button', { name: 'Unassigned' })).toBeVisible({
        timeout: 10000,
      })
      await panel.getByRole('button', { name: 'Unassigned' }).click()
      await page.getByRole('menuitem', { name: 'Assign to me' }).click()
      await expect(panel.getByRole('button', { name: /Demo User/ })).toBeVisible({ timeout: 10000 })

      // Change priority to High.
      await panel.getByRole('button', { name: 'Priority' }).click()
      await page.getByRole('menuitem', { name: 'High' }).click()
      await expect(panel.getByRole('button', { name: 'High' })).toBeVisible({ timeout: 10000 })

      // Convert-to-post: the conversation-level "Track as feedback" button opens
      // the dialog prefilled with the subject + the FIRST visitor message.
      await panel.getByRole('button', { name: 'Track as feedback' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('#convert-title')).toHaveValue(seeded.subject)
      await expect(dialog.locator('#convert-content')).toHaveValue(seeded.messages[0])
      await dialog.getByRole('button', { name: 'Track as feedback' }).click()
      await waitForToast(page, /Post created from conversation|Upvoted existing post/)
      await expect(dialog).toBeHidden({ timeout: 10000 })

      // Snooze lives on the thread-header moon control (the status menu is
      // only Open/Closed now). The status badge still flips to 'snoozed'.
      await page.getByRole('button', { name: 'Snooze' }).click()
      await page.getByRole('menuitem', { name: 'Until they reply' }).click()
      await expect(panel.getByRole('button', { name: 'snoozed', exact: true })).toBeVisible({
        timeout: 10000,
      })

      // Close the conversation via the status control (kept last: the default
      // list filter is 'open', so the row drops out of the list after this).
      await panel.getByRole('button', { name: 'snoozed', exact: true }).click()
      await page.getByRole('menuitem', { name: 'closed' }).click()
      await expect(panel.getByRole('button', { name: 'closed', exact: true })).toBeVisible({
        timeout: 10000,
      })
    }
  )
})

/**
 * The keyboard-first + bulk layer (support platform §4.6): selecting a row
 * surfaces the floating bulk-action toolbar, and its Close acts on the whole
 * selection. Its own seed (a separate conversation) so it never races the
 * lifecycle test's shared thread.
 */
test.describe.skip('Admin Support Inbox bulk actions', { tag: '@smoke' }, () => {
  let seeded: SeededConversation

  test.beforeAll(() => {
    setSupportSurfaces(true)
    seeded = seedConversation(`E2E bulk conversation ${Date.now()}`)
  })

  test('multi-select then bulk close', async ({ page }) => {
    await page.goto('/admin/inbox')

    // The seeded row (grouped div carries the `group` class) — check its box.
    const row = page.locator('div.group').filter({ hasText: seeded.messages[1] }).first()
    await expect(row).toBeVisible({ timeout: 15000 })

    // The list is server-rendered before React hydrates, so a first click can
    // land on inert HTML. Per-row checkboxes are opacity-0 until hover, so
    // hover first or Playwright will not consider them visible.
    const toolbar = page.getByRole('toolbar', { name: 'Bulk actions' })
    await expect(async () => {
      await row.hover()
      await row.getByRole('checkbox').click()
      await expect(toolbar).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 15000 })

    // The floating bulk toolbar shows the count, and Close acts on the selection.
    await expect(toolbar.getByText('1 selected')).toBeVisible({ timeout: 10000 })
    await toolbar.getByRole('button', { name: 'Close', exact: true }).click()

    // The summary toast confirms the bulk apply; the row leaves the open list.
    await waitForToast(page, /Closed 1 item/)
    await expect(row).toBeHidden({ timeout: 10000 })
  })
})
