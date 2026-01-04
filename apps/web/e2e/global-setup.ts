import { test as setup, expect } from '@playwright/test'
import { getOtpCode, ensureTestUserHasRole } from './utils/db-helpers'

const ADMIN_EMAIL = 'demo@example.com'
const AUTH_FILE = 'e2e/.auth/admin.json'
const TEST_HOST = 'acme.localhost:3000'

/**
 * Global setup: Authenticate as admin using Better-auth OTP flow
 *
 * Uses Better-auth's emailOTP plugin:
 * 1. Send OTP code to email (logged to console when RESEND_API_KEY not configured)
 * 2. Retrieve OTP code directly from database
 * 3. Verify OTP and sign in via Better-auth
 * 4. Navigate to admin page to verify authentication
 */
setup('authenticate as admin', async ({ page }) => {
  // Use page.request so cookies are shared with the page context
  const request = page.request

  // Step 1: Request OTP code via Better-auth
  const sendResponse = await request.post('/api/auth/email-otp/send-verification-otp', {
    data: {
      email: ADMIN_EMAIL,
      type: 'sign-in',
    },
  })
  expect(sendResponse.ok()).toBeTruthy()

  // Step 2: Get OTP code directly from database
  const code = await getOtpCode(ADMIN_EMAIL, TEST_HOST)
  expect(code).toMatch(/^\d{6}$/) // 6-digit code

  // Step 3: Verify OTP code and sign in via Better-auth
  // This sets the session cookie in the page context and creates the user if not exists
  const verifyResponse = await request.post('/api/auth/sign-in/email-otp', {
    data: {
      email: ADMIN_EMAIL,
      otp: code,
    },
  })
  expect(verifyResponse.ok()).toBeTruthy()

  // Step 4: Ensure test user has admin role (user now exists after OTP verification)
  ensureTestUserHasRole(ADMIN_EMAIL, 'admin')

  // Step 5: Navigate to admin page
  // Session cookie is now set by Better-auth in the page context
  await page.goto('/admin')
  await page.waitForLoadState('networkidle')

  // Verify we're on admin page (not redirected to login)
  await expect(page).toHaveURL(/\/admin/, { timeout: 10000 })

  // Save authentication state
  await page.context().storageState({ path: AUTH_FILE })
})
