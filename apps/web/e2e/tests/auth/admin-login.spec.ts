import { test, expect } from '@playwright/test'
import { TEST_ADMIN } from '../../fixtures/auth'
import { getOtpCode } from '../../utils/db-helpers'

const TEST_HOST = 'acme.localhost:3000'

test.describe('Admin Login with OTP', () => {
  // Configure tests to run serially to avoid OTP race conditions
  // Multiple tests requesting OTP codes for the same email in parallel
  // can interfere with each other since getOtpCode() retrieves the most recent code
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    // Start fresh - clear any existing session
    await page.context().clearCookies()
  })

  test('shows OTP login form with email input', async ({ page }) => {
    await page.goto('/admin/login')

    // Wait for page heading
    const heading = page.getByRole('heading', { name: /team sign in/i, level: 1 })
    await expect(heading).toBeVisible({ timeout: 15000 })

    // Check for description text
    await expect(page.getByText(/sign in to access the admin dashboard/i)).toBeVisible()

    // Check for email input field
    const emailInput = page.locator('input[type="email"]')
    await expect(emailInput).toBeVisible()
    await expect(emailInput).toHaveAttribute('placeholder', 'you@example.com')

    // Check for continue button (not "Sign in" anymore, but "Continue with email")
    await expect(page.getByRole('button', { name: /continue with email/i })).toBeVisible()
  })

  test('completes full OTP login flow', async ({ page }) => {
    await page.goto('/admin/login')

    // Step 1: Enter email
    const emailInput = page.locator('input[type="email"]')
    await expect(emailInput).toBeVisible({ timeout: 15000 })
    await expect(emailInput).toBeEnabled()

    await emailInput.fill(TEST_ADMIN.email)

    // Submit email and wait for OTP send API response
    const [sendResponse] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/auth/email-otp/send-verification-otp'),
        {
          timeout: 15000,
        }
      ),
      page.getByRole('button', { name: /continue with email/i }).click(),
    ])

    expect(sendResponse.ok()).toBeTruthy()

    // Step 2: Code input should now be visible
    await expect(page.getByText(/we sent a 6-digit code to/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(TEST_ADMIN.email)).toBeVisible()

    // Get the OTP code from the database
    const code = getOtpCode(TEST_ADMIN.email, TEST_HOST)
    expect(code).toMatch(/^\d{6}$/) // Should be a 6-digit code

    // Enter the code
    const codeInput = page.locator('input#code')
    await expect(codeInput).toBeVisible()
    await expect(codeInput).toHaveAttribute('maxlength', '6')
    await codeInput.fill(code)

    // Submit code and wait for verification
    const [verifyResponse] = await Promise.all([
      page.waitForResponse((resp) => resp.url().includes('/api/auth/sign-in/email-otp'), {
        timeout: 15000,
      }),
      page.getByRole('button', { name: /verify code/i }).click(),
    ])

    expect(verifyResponse.ok()).toBeTruthy()

    // Should redirect to admin dashboard after successful authentication
    await expect(page).toHaveURL(/\/admin/, { timeout: 15000 })
  })

  test('shows error with invalid OTP code', async ({ page }) => {
    await page.goto('/admin/login')

    // Step 1: Enter email and request OTP
    const emailInput = page.locator('input[type="email"]')
    await emailInput.fill(TEST_ADMIN.email)

    await Promise.all([
      page.waitForResponse((resp) =>
        resp.url().includes('/api/auth/email-otp/send-verification-otp')
      ),
      page.getByRole('button', { name: /continue with email/i }).click(),
    ])

    // Step 2: Enter invalid code
    const codeInput = page.locator('input#code')
    await expect(codeInput).toBeVisible({ timeout: 10000 })
    await codeInput.fill('000000') // Invalid code

    // Submit and wait for error
    await page.getByRole('button', { name: /verify code/i }).click()

    // Should show error message
    await expect(page.getByText(/invalid|incorrect|failed to verify/i)).toBeVisible({
      timeout: 10000,
    })

    // Should stay on the code verification step
    await expect(codeInput).toBeVisible()
  })

  test('allows going back from code step to email step', async ({ page }) => {
    await page.goto('/admin/login')

    // Enter email and proceed to code step
    const emailInput = page.locator('input[type="email"]')
    await emailInput.fill(TEST_ADMIN.email)

    await Promise.all([
      page.waitForResponse((resp) =>
        resp.url().includes('/api/auth/email-otp/send-verification-otp')
      ),
      page.getByRole('button', { name: /continue with email/i }).click(),
    ])

    // Verify we're on code step
    await expect(page.locator('input#code')).toBeVisible({ timeout: 10000 })

    // Click back button
    const backButton = page.getByRole('button', { name: /back/i })
    await expect(backButton).toBeVisible()
    await backButton.click()

    // Should be back on email step
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /continue with email/i })).toBeVisible()
  })

  test('redirects to callback URL after successful login', async ({ page }) => {
    const callbackUrl = '/admin/settings/boards'
    await page.goto(`/admin/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)

    // Complete OTP flow
    const emailInput = page.locator('input[type="email"]')
    await emailInput.fill(TEST_ADMIN.email)

    await Promise.all([
      page.waitForResponse((resp) =>
        resp.url().includes('/api/auth/email-otp/send-verification-otp')
      ),
      page.getByRole('button', { name: /continue with email/i }).click(),
    ])

    // Get OTP code and verify
    const code = getOtpCode(TEST_ADMIN.email, TEST_HOST)
    const codeInput = page.locator('input#code')
    await expect(codeInput).toBeVisible({ timeout: 10000 })
    await codeInput.fill(code)

    const [verifyResponse] = await Promise.all([
      page.waitForResponse((resp) => resp.url().includes('/api/auth/sign-in/email-otp')),
      page.getByRole('button', { name: /verify code/i }).click(),
    ])

    expect(verifyResponse.ok()).toBeTruthy()

    // Should redirect to the callback URL
    await expect(page).toHaveURL(new RegExp(callbackUrl), { timeout: 15000 })
  })

  test('shows resend code option after cooldown', async ({ page }) => {
    await page.goto('/admin/login')

    // Request OTP code
    const emailInput = page.locator('input[type="email"]')
    await emailInput.fill(TEST_ADMIN.email)

    await Promise.all([
      page.waitForResponse((resp) =>
        resp.url().includes('/api/auth/email-otp/send-verification-otp')
      ),
      page.getByRole('button', { name: /continue with email/i }).click(),
    ])

    // Should see resend button (initially disabled with cooldown)
    await expect(page.locator('input#code')).toBeVisible({ timeout: 10000 })
    const resendButton = page.getByRole('button', { name: /resend code in \d+s/i })
    await expect(resendButton).toBeVisible()
    await expect(resendButton).toBeDisabled()

    // After some time, check the cooldown text changes (not waiting full 60s)
    // Just verify the pattern exists
    await expect(page.getByText(/resend code in \d+s/i)).toBeVisible()
  })

  // Skip OAuth test - requires OAuth providers to be configured in seed data
  test.skip('shows OAuth login options', async ({ page }) => {
    await page.goto('/admin/login')

    // OAuth buttons should be visible before entering email
    // Based on the OTPAuthForm component, OAuth is shown with showOAuth=true
    await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible({
      timeout: 10000,
    })
    await expect(page.getByRole('button', { name: /sign in with github/i })).toBeVisible()

    // Separator text
    await expect(page.getByText(/or continue with email/i)).toBeVisible()
  })

  test('verify code button is disabled until 6 digits entered', async ({ page }) => {
    await page.goto('/admin/login')

    // Request OTP code
    const emailInput = page.locator('input[type="email"]')
    await emailInput.fill(TEST_ADMIN.email)

    await Promise.all([
      page.waitForResponse((resp) =>
        resp.url().includes('/api/auth/email-otp/send-verification-otp')
      ),
      page.getByRole('button', { name: /continue with email/i }).click(),
    ])

    const codeInput = page.locator('input#code')
    await expect(codeInput).toBeVisible({ timeout: 10000 })

    const verifyButton = page.getByRole('button', { name: /verify code/i })

    // Button should be disabled initially
    await expect(verifyButton).toBeDisabled()

    // Enter only 3 digits
    await codeInput.fill('123')
    await expect(verifyButton).toBeDisabled()

    // Enter 6 digits
    await codeInput.fill('123456')
    await expect(verifyButton).toBeEnabled()
  })
})
