import { test as setup, expect } from '@playwright/test'
import { getOtpCode } from './utils/db-helpers'

const ADMIN_EMAIL = 'demo@example.com'
const AUTH_FILE = 'e2e/.auth/admin.json'
const TEST_HOST = 'acme.localhost:3000'

/**
 * Global setup: Authenticate as admin using real OTP flow
 *
 * Uses the actual OTP authentication flow:
 * 1. Send OTP code to email (logged to console when RESEND_API_KEY not configured)
 * 2. Retrieve OTP code directly from database
 * 3. Verify OTP and get redirect URL
 * 4. Navigate to redirect URL to complete authentication
 */
setup('authenticate as admin', async ({ page, request }) => {
  // Step 1: Request OTP code
  const sendResponse = await request.post('/api/auth/tenant-otp/send', {
    data: { email: ADMIN_EMAIL },
  })
  expect(sendResponse.ok()).toBeTruthy()

  // Step 2: Get OTP code directly from database
  const code = await getOtpCode(ADMIN_EMAIL, TEST_HOST)
  expect(code).toMatch(/^\d{6}$/) // 6-digit code

  // Step 3: Verify OTP code
  const verifyResponse = await request.post('/api/auth/tenant-otp/verify', {
    data: {
      email: ADMIN_EMAIL,
      code,
      context: 'team',
      callbackUrl: '/admin',
    },
  })
  expect(verifyResponse.ok()).toBeTruthy()

  const verifyData = await verifyResponse.json()
  expect(verifyData.success).toBe(true)
  expect(verifyData.redirectUrl).toBeTruthy()

  // Step 4: Navigate to trust-login URL to complete authentication
  // This sets the session cookie
  await page.goto(verifyData.redirectUrl)
  await page.waitForLoadState('networkidle')

  // Verify we're on admin page (redirected after auth)
  await expect(page).toHaveURL(/\/admin/, { timeout: 10000 })

  // Save authentication state
  await page.context().storageState({ path: AUTH_FILE })
})
