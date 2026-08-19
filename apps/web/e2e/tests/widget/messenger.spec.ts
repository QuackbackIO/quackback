import { test, expect } from '@playwright/test'
import { setSupportSurfaces } from '../../utils/db-helpers'

/**
 * Characterization net for the widget messenger, pinning anonymous visitor
 * behavior: the widget route loads directly (the SDK normally iframes
 * /widget; the route itself needs no params), the Messages tab lists the
 * visitor's conversations, the first send lazily mints an anonymous session,
 * and the persisted token survives a reload so the visitor keeps their
 * conversation (the persisted signed bearer form is normalized to the raw
 * session token server-side; see lib/server/auth/session-token.ts).
 *
 * Deliberately independent of agent activity - no replies are awaited.
 */
test.describe('Widget messenger (anonymous visitor)', { tag: '@smoke' }, () => {
  test.beforeAll(() => {
    setSupportSurfaces(true)
  })

  test('start a conversation and send a message that renders', async ({ page }) => {
    await page.goto('/widget')

    // Fresh browser context = fresh anonymous visitor: the Messages tab shows
    // the empty state.
    await page.getByRole('button', { name: 'Messages', exact: true }).click()
    await expect(page.getByText('No conversations yet')).toBeVisible({ timeout: 10000 })

    // Start a new conversation from the pinned pill.
    await page.getByRole('button', { name: /Ask a question/ }).click()
    const composer = page.locator('.ProseMirror[contenteditable="true"]')
    await expect(composer).toBeVisible({ timeout: 10000 })

    const message = `Widget e2e message ${Date.now()}`
    await composer.click()
    await composer.fill(message)
    // The first send mints the anonymous session, then creates the conversation.
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText(message)).toBeVisible({ timeout: 15000 })

    // The minted anonymous token is persisted to the iframe-origin localStorage.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            window.localStorage.getItem(`quackback:anon-token:${window.location.origin}`)
          ),
        { timeout: 10000 }
      )
      .not.toBeNull()

    // Within the same page session, the Messages list shows the conversation
    // (in-memory token; back via the thread's back affordance is covered by
    // navigating the tab bar after the panel state resets on reload below).

    // After a reload the persisted token restores the anonymous session, so
    // the visitor's conversation survives: the Messages list shows the thread
    // (the sent message is the conversation preview) and the token remains.
    await page.reload()
    await page.getByRole('button', { name: 'Messages', exact: true }).click()
    await expect(page.getByText(message).first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('No conversations yet')).not.toBeVisible()
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            window.localStorage.getItem(`quackback:anon-token:${window.location.origin}`)
          ),
        { timeout: 10000 }
      )
      .not.toBeNull()
  })
})
