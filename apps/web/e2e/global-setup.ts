import { test as setup, expect } from '@playwright/test'

const ADMIN_EMAIL = 'demo@example.com'
const AUTH_FILE = 'e2e/.auth/admin.json'

/**
 * Global setup: Authenticate as admin and save session state
 *
 * Uses test-only API endpoint to create session directly, bypassing OTP flow.
 */
setup('authenticate as admin', async ({ page, request }) => {
  // Use test helper API to create session directly
  // This bypasses the OTP email verification flow which is not practical for E2E tests
  const response = await request.post('/api/test/create-session', {
    data: { email: ADMIN_EMAIL },
  })

  expect(response.ok()).toBeTruthy()

  const data = await response.json()
  const { sessionToken } = data

  // Set the session cookie manually
  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: sessionToken,
      domain: 'acme.localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Date.now() / 1000 + 7 * 24 * 60 * 60, // 7 days
    },
  ])

  // Navigate to admin dashboard to verify session works
  await page.goto('/admin')
  await page.waitForLoadState('networkidle')

  // Verify we're on admin page (not redirected back to login)
  await expect(page).toHaveURL(/\/admin/, { timeout: 10000 })

  // Save authentication state
  await page.context().storageState({ path: AUTH_FILE })
})
