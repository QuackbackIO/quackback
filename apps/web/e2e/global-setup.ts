import { test as setup, expect } from '@playwright/test'
import { getMagicLinkToken, ensureTestUserHasRole } from './utils/db-helpers'

const ADMIN_EMAIL = 'demo@example.com'
const AUTH_FILE = 'e2e/.auth/admin.json'

/**
 * Global setup: Authenticate as admin via Better-auth's magic-link plugin.
 *
 * 1. POST /api/auth/sign-in/magic-link to provision a verification row
 *    (in dev with no email configured the callback warns but the token
 *    still lands in the verification table)
 * 2. Read the live token directly from the DB
 * 3. GET /api/auth/magic-link/verify?token=… to consume it and set the
 *    session cookie on the page context
 * 4. Ensure the test user has admin role
 * 5. Smoke /admin and persist the auth state
 */
setup('authenticate as admin', async ({ page }) => {
  const request = page.request

  // Step 1: Trigger magic-link verification token creation
  const sendResponse = await request.post('/api/auth/sign-in/magic-link', {
    data: {
      email: ADMIN_EMAIL,
      callbackURL: '/admin',
    },
  })
  expect(sendResponse.ok()).toBeTruthy()

  // Step 2: Pull the token directly from the verification table
  const token = getMagicLinkToken(ADMIN_EMAIL)
  expect(token.length).toBeGreaterThan(8)

  // Step 3: Verify the token — sets the session cookie via the redirect chain
  const verifyResponse = await request.get(
    `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent('/admin')}`,
    { maxRedirects: 5 }
  )
  expect(verifyResponse.ok()).toBeTruthy()

  // Step 4: Ensure test user has admin role (user now exists after verify)
  ensureTestUserHasRole(ADMIN_EMAIL, 'admin')

  // Step 5: Navigate to admin page and confirm we land there (not login)
  await page.goto('/admin')
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveURL(/\/admin/, { timeout: 10000 })

  await page.context().storageState({ path: AUTH_FILE })
})
