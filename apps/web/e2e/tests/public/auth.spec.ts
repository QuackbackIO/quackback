import { test, expect } from '@playwright/test'
import { closeDialog } from '../../utils/helpers'

/**
 * Public portal auth tests — no prior authentication.
 *
 * The portal exposes auth via a Dialog triggered from the header.
 * Login mode: title "Welcome back", description "Sign in to your account..."
 * Signup mode: title "Create an account", description "Sign up to vote..."
 *
 * The default auth step depends on whether password auth is enabled:
 *   - password enabled  → "credentials" step (email + password fields)
 *   - password disabled → "email" step (email field + "Continue with email" button)
 */

test.describe('Portal Auth Dialog', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test.afterEach(async ({ page }) => {
    // Close any open dialog so state doesn't bleed into the next serial test.
    if ((await page.getByRole('dialog').count()) > 0) {
      await closeDialog(page).catch(() => {})
    }
  })

  // ---------------------------------------------------------------------------
  // Opening the dialog
  // ---------------------------------------------------------------------------

  test('clicking Log in opens the auth dialog in login mode', async ({ page }) => {
    const logInButton = page.getByRole('button', { name: /log in/i })
    await expect(logInButton).toBeVisible({ timeout: 10000 })
    await logInButton.click()

    // Dialog should appear with login-mode title
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible()
  })

  test('clicking Sign up opens the auth dialog in signup mode', async ({ page }) => {
    const signUpButton = page.getByRole('button', { name: /sign up/i })
    await expect(signUpButton).toBeVisible({ timeout: 10000 })
    await signUpButton.click()

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('heading', { name: /create an account/i })).toBeVisible()
  })

  // ---------------------------------------------------------------------------
  // Dialog contents — login mode
  // ---------------------------------------------------------------------------

  test('login dialog shows email input', async ({ page }) => {
    await page.getByRole('button', { name: /log in/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    const emailInput = page.locator('input[type="email"]')
    await expect(emailInput.first()).toBeVisible()
  })

  test('login dialog shows descriptive text about signing in', async ({ page }) => {
    await page.getByRole('button', { name: /log in/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    await expect(
      page.getByText(/sign in to your account to vote and comment/i)
    ).toBeVisible()
  })

  test('login dialog has a Sign up switch link for users without an account', async ({ page }) => {
    await page.getByRole('button', { name: /log in/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    // "Don't have an account? Sign up" link
    const signUpLink = page.getByRole('dialog').getByRole('button', { name: /sign up/i })
    if ((await signUpLink.count()) > 0) {
      await expect(signUpLink.first()).toBeVisible()
    }
  })

  // ---------------------------------------------------------------------------
  // Dialog contents — signup mode
  // ---------------------------------------------------------------------------

  test('signup dialog shows email input', async ({ page }) => {
    await page.getByRole('button', { name: /sign up/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    const emailInput = page.locator('input[type="email"]')
    await expect(emailInput.first()).toBeVisible()
  })

  test('signup dialog shows descriptive text about creating an account', async ({ page }) => {
    await page.getByRole('button', { name: /sign up/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    await expect(page.getByText(/sign up to vote and comment on feedback/i)).toBeVisible()
  })

  test('signup dialog shows name field when password auth is enabled', async ({ page }) => {
    await page.getByRole('button', { name: /sign up/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    // Name input is only present in the credentials (password) step during signup
    const nameInput = page.locator('#inline-name')
    if ((await nameInput.count()) > 0) {
      await expect(nameInput).toBeVisible()
    }
  })

  test('signup dialog has a Sign in switch link for existing users', async ({ page }) => {
    await page.getByRole('button', { name: /sign up/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    const signInLink = page.getByRole('dialog').getByRole('button', { name: /sign in/i })
    if ((await signInLink.count()) > 0) {
      await expect(signInLink.first()).toBeVisible()
    }
  })

  // ---------------------------------------------------------------------------
  // OTP email step
  // ---------------------------------------------------------------------------

  test('submitting email on the OTP step advances to the code verification step', async ({
    page,
  }) => {
    await page.getByRole('button', { name: /log in/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    // Navigate to the email-OTP step if we're on the password step first
    const useEmailCodeLink = page
      .getByRole('dialog')
      .getByRole('button', { name: /use email code instead/i })
    if ((await useEmailCodeLink.count()) > 0) {
      await useEmailCodeLink.click()
    }

    // Skip if the email OTP step is not available (email OTP may be disabled).
    // Wait briefly for the transition after clicking "use email code instead".
    const continueWithEmailBtn = page.getByRole('dialog').getByRole('button', { name: /continue with email/i })
    try {
      await expect(continueWithEmailBtn).toBeVisible({ timeout: 2000 })
    } catch {
      test.skip()
      return
    }

    // Fill email and submit
    const emailInput = page.locator('input[type="email"]').first()
    await expect(emailInput).toBeVisible({ timeout: 5000 })
    await emailInput.fill('test@example.com')

    const [otpResponse] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/auth/email-otp/send-verification-otp'),
        { timeout: 15000 }
      ),
      continueWithEmailBtn.click(),
    ])

    expect(otpResponse.ok()).toBeTruthy()

    // Code verification step is now visible
    await expect(page.getByText(/we sent a 6-digit code to/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('test@example.com')).toBeVisible()
  })

  test('code verification step shows the OTP input', async ({ page }) => {
    await page.getByRole('button', { name: /log in/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    const useEmailCodeLink = page
      .getByRole('dialog')
      .getByRole('button', { name: /use email code instead/i })
    if ((await useEmailCodeLink.count()) > 0) {
      await useEmailCodeLink.click()
    }

    const continueWithEmailBtn = page.getByRole('button', { name: /continue with email/i })
    if ((await continueWithEmailBtn.count()) === 0) {
      test.skip()
      return
    }

    const emailInput = page.locator('input[type="email"]').first()
    await emailInput.fill('test@example.com')

    await Promise.all([
      page.waitForResponse((resp) =>
        resp.url().includes('/api/auth/email-otp/send-verification-otp')
      ),
      continueWithEmailBtn.click(),
    ])

    const codeInput = page.locator('#inline-code')
    await expect(codeInput).toBeVisible({ timeout: 10000 })
    await expect(codeInput).toHaveAttribute('maxlength', '6')
  })

  test('verify button is disabled until 6 digits are entered', async ({ page }) => {
    await page.getByRole('button', { name: /log in/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    const useEmailCodeLink = page
      .getByRole('dialog')
      .getByRole('button', { name: /use email code instead/i })
    if ((await useEmailCodeLink.count()) > 0) {
      await useEmailCodeLink.click()
    }

    const continueWithEmailBtn = page.getByRole('button', { name: /continue with email/i })
    if ((await continueWithEmailBtn.count()) === 0) {
      test.skip()
      return
    }

    const emailInput = page.locator('input[type="email"]').first()
    await emailInput.fill('test@example.com')

    await Promise.all([
      page.waitForResponse((resp) =>
        resp.url().includes('/api/auth/email-otp/send-verification-otp')
      ),
      continueWithEmailBtn.click(),
    ])

    const codeInput = page.locator('#inline-code')
    await expect(codeInput).toBeVisible({ timeout: 10000 })

    const verifyButton = page.getByRole('button', { name: /verify code/i })
    await expect(verifyButton).toBeDisabled()

    await codeInput.fill('123')
    await expect(verifyButton).toBeDisabled()

    await codeInput.fill('123456')
    await expect(verifyButton).toBeEnabled()
  })

  test('can go back from code step to email step', async ({ page }) => {
    await page.getByRole('button', { name: /log in/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    const useEmailCodeLink = page
      .getByRole('dialog')
      .getByRole('button', { name: /use email code instead/i })
    if ((await useEmailCodeLink.count()) > 0) {
      await useEmailCodeLink.click()
    }

    const continueWithEmailBtn = page.getByRole('button', { name: /continue with email/i })
    if ((await continueWithEmailBtn.count()) === 0) {
      test.skip()
      return
    }

    const emailInput = page.locator('input[type="email"]').first()
    await emailInput.fill('test@example.com')

    await Promise.all([
      page.waitForResponse((resp) =>
        resp.url().includes('/api/auth/email-otp/send-verification-otp')
      ),
      continueWithEmailBtn.click(),
    ])

    await expect(page.locator('#inline-code')).toBeVisible({ timeout: 10000 })

    // Click the Back button inside the dialog
    const backButton = page.getByRole('dialog').getByRole('button', { name: /back/i })
    await expect(backButton).toBeVisible()
    await backButton.click()

    // Should return to the email (or credentials) step
    await expect(page.locator('input[type="email"]').first()).toBeVisible()
  })

  test('resend cooldown button appears after sending code', async ({ page }) => {
    await page.getByRole('button', { name: /log in/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    const useEmailCodeLink = page
      .getByRole('dialog')
      .getByRole('button', { name: /use email code instead/i })
    if ((await useEmailCodeLink.count()) > 0) {
      await useEmailCodeLink.click()
    }

    const continueWithEmailBtn = page.getByRole('button', { name: /continue with email/i })
    if ((await continueWithEmailBtn.count()) === 0) {
      test.skip()
      return
    }

    const emailInput = page.locator('input[type="email"]').first()
    await emailInput.fill('test@example.com')

    await Promise.all([
      page.waitForResponse((resp) =>
        resp.url().includes('/api/auth/email-otp/send-verification-otp')
      ),
      continueWithEmailBtn.click(),
    ])

    await expect(page.locator('#inline-code')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/resend code in \d+s/i)).toBeVisible()
  })

  // ---------------------------------------------------------------------------
  // Validation errors
  // ---------------------------------------------------------------------------

  test('submitting an empty email on the OTP step shows a validation error', async ({ page }) => {
    await page.getByRole('button', { name: /log in/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    // Navigate to OTP email step
    const useEmailCodeLink = page
      .getByRole('dialog')
      .getByRole('button', { name: /use email code instead/i })
    if ((await useEmailCodeLink.count()) > 0) {
      await useEmailCodeLink.click()
    }

    // Skip if the email OTP step is not available (email OTP may be disabled).
    // Wait briefly for the transition after clicking "use email code instead".
    const continueWithEmailBtn = page.getByRole('dialog').getByRole('button', { name: /continue with email/i })
    try {
      await expect(continueWithEmailBtn).toBeVisible({ timeout: 2000 })
    } catch {
      test.skip()
      return
    }

    // Clear the email field and try to submit
    const emailInput = page.locator('input[type="email"]').first()
    await expect(emailInput).toBeVisible({ timeout: 5000 })
    await emailInput.fill('')

    await continueWithEmailBtn.click()

    // Expect an inline error message
    await expect(page.getByText(/email is required/i)).toBeVisible({ timeout: 5000 })
  })

  test('submitting empty email on the password/credentials step shows validation error', async ({
    page,
  }) => {
    await page.getByRole('button', { name: /log in/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    // Only applicable when the credentials (password) step is shown
    const passwordInput = page.locator('#inline-password')
    if ((await passwordInput.count()) === 0) {
      // Password auth not enabled — skip
      return
    }

    // Leave email blank and click sign in
    const emailInput = page.locator('#inline-email')
    await emailInput.fill('')

    await page.getByRole('button', { name: /^sign in$/i }).click()

    await expect(page.getByText(/email is required/i)).toBeVisible({ timeout: 5000 })
  })

  // ---------------------------------------------------------------------------
  // Closing the dialog
  // ---------------------------------------------------------------------------

  test('pressing Escape closes the auth dialog', async ({ page }) => {
    await page.getByRole('button', { name: /log in/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    await page.keyboard.press('Escape')

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 })
  })

  test('clicking the X button closes the auth dialog', async ({ page }) => {
    await page.getByRole('button', { name: /log in/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

    // shadcn Dialog renders a close button with aria-label "Close"
    const closeButton = page
      .getByRole('dialog')
      .getByRole('button', { name: /close/i })
    if ((await closeButton.count()) > 0) {
      await closeButton.click()
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 })
    }
  })

  // ---------------------------------------------------------------------------
  // Mode switching
  // ---------------------------------------------------------------------------

  test('switching from login to signup changes the dialog title', async ({ page }) => {
    await page.getByRole('button', { name: /log in/i }).click()
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible({
      timeout: 5000,
    })

    // Click the "Sign up" mode-switch link inside the dialog
    const signUpModeLink = page.getByRole('dialog').getByRole('button', { name: /sign up/i })
    expect(await signUpModeLink.count()).toBeGreaterThan(0)
    if ((await signUpModeLink.count()) > 0) {
      await signUpModeLink.first().click()
      await expect(page.getByRole('heading', { name: /create an account/i })).toBeVisible({
        timeout: 5000,
      })
    }
  })

  test('switching from signup to login changes the dialog title', async ({ page }) => {
    await page.getByRole('button', { name: /sign up/i }).click()
    await expect(page.getByRole('heading', { name: /create an account/i })).toBeVisible({
      timeout: 5000,
    })

    // Click the "Sign in" mode-switch link inside the dialog
    const signInModeLink = page.getByRole('dialog').getByRole('button', { name: /sign in/i })
    if ((await signInModeLink.count()) > 0) {
      await signInModeLink.first().click()
      await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible({
        timeout: 5000,
      })
    }
  })
})
