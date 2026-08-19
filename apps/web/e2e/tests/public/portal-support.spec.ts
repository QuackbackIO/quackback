import { test, expect } from '@playwright/test'
import {
  setSupportSurfaces,
  seedConversation,
  clearSigninRateLimit,
  enableMagicLinkMethod,
  getMagicLinkToken,
} from '../../utils/db-helpers'

/**
 * Characterization net for the portal Support tab (/support), pinning CURRENT
 * behavior: the tab requires supportInbox + portalConfig.support.enabled, a
 * signed-in portal user first sees the empty state, and a conversation owned
 * by their principal renders in the list and opens as a thread.
 *
 * Signs in via the magic-link flow (mirrors global-setup) with a unique email
 * per run, so the empty state is deterministic across repeated runs.
 */
test.describe('Portal Support tab', { tag: '@smoke' }, () => {
  test.beforeAll(() => {
    // Magic link is opt-in (authConfig.oauth.magicLink) and gates portal users
    // too - open it before the sign-in below. Both helpers bust the settings
    // cache themselves.
    enableMagicLinkMethod()
    setSupportSurfaces(true)
    // Repeated runs from one machine trip the per-IP magic-link limiter.
    clearSigninRateLimit()
  })

  test('signed-in user sees the empty state, then their seeded conversation', async ({ page }) => {
    const email = `e2e-portal-support-${Date.now()}@example.com`

    // Magic-link sign-in: request the link, read the live token from the DB,
    // then consume it so the session cookie lands on this context.
    const sendResponse = await page.request.post('/api/auth/sign-in/magic-link', {
      data: { email, callbackURL: '/' },
    })
    expect(sendResponse.ok()).toBeTruthy()
    const token = getMagicLinkToken(email)
    const verifyResponse = await page.request.get(
      `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent('/')}`,
      { maxRedirects: 5 }
    )
    expect(verifyResponse.ok()).toBeTruthy()

    // A fresh user has no conversations: the empty state renders.
    await page.goto('/support')
    await expect(page.getByRole('heading', { name: 'Support' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('No conversations yet')).toBeVisible({ timeout: 10000 })

    // Seed a conversation owned by this user and confirm list + thread render.
    const seeded = seedConversation(`E2E portal conversation ${Date.now()}`, email)
    await page.goto('/support')
    const rowLink = page.getByRole('link', { name: new RegExp(seeded.subject) })
    await expect(rowLink).toBeVisible({ timeout: 10000 })
    await rowLink.click()
    await expect(page).toHaveURL(new RegExp(`/support/${seeded.conversationId}`))
    await expect(page.getByText(seeded.messages[0])).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(seeded.messages[1])).toBeVisible({ timeout: 10000 })
  })
})
