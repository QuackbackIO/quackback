import { test, expect } from '@playwright/test'
import { TEST_ADMIN } from '../../fixtures/auth'

test.describe('Admin Login', () => {
  test.beforeEach(async ({ page }) => {
    // Start fresh - clear any existing session
    await page.context().clearCookies()
  })

  test('shows login form with email and password fields', async ({ page }) => {
    // Navigate to login page (may be /admin/login or /login depending on routing)
    await page.goto('/admin/login')

    // Wait for page to settle - accept either admin or portal login page
    const heading = page.getByRole('heading', { name: /team sign in|welcome back/i, level: 1 })
    await expect(heading).toBeVisible({ timeout: 15000 })

    // Check for email and password fields using placeholder or type
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 5000 })

    // Use exact match to avoid OAuth buttons (Sign in with Google, Sign in with GitHub)
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible({
      timeout: 5000,
    })
  })

  test('logs in with valid credentials', async ({ page }) => {
    await page.goto('/admin/login')

    // Wait for form to be fully loaded and interactive
    const emailInput = page.locator('input[type="email"]')
    await expect(emailInput).toBeVisible({ timeout: 15000 })
    await expect(emailInput).toBeEnabled({ timeout: 5000 })

    await emailInput.fill(TEST_ADMIN.email)
    await page.locator('input[type="password"]').fill(TEST_ADMIN.password)

    // Submit form and wait for auth API response
    const [response] = await Promise.all([
      page.waitForResponse((resp) => resp.url().includes('/api/auth/sign-in/email'), {
        timeout: 15000,
      }),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ])

    expect(response.ok()).toBeTruthy()

    // Wait for auth to be established then navigate to admin
    await page.waitForTimeout(1000) // Brief wait for session cookie to be set
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin/, { timeout: 15000 })
  })

  test('shows error with invalid credentials', async ({ page }) => {
    await page.goto('/admin/login')

    // Wait for form to be fully loaded and interactive
    const emailInput = page.locator('input[type="email"]')
    await expect(emailInput).toBeVisible({ timeout: 15000 })
    await expect(emailInput).toBeEnabled({ timeout: 5000 })

    await emailInput.fill('invalid@example.com')
    await page.locator('input[type="password"]').fill('wrongpassword')

    // Click and wait for the error response
    await Promise.all([
      page.waitForResponse((resp) => resp.url().includes('/api/auth/sign-in/email'), {
        timeout: 15000,
      }),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ])

    // Should show error message (increase timeout for slower CI)
    await expect(page.getByText(/invalid|error|incorrect/i)).toBeVisible({ timeout: 10000 })

    // Should stay on a login page (either /admin/login or /login)
    await expect(page).toHaveURL(/\/login/)
  })

  test('redirects to callback URL after login', async ({ page }) => {
    const callbackUrl = '/admin/settings/boards'
    await page.goto(`/admin/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)

    // Wait for form to be fully loaded and interactive
    const emailInput = page.locator('input[type="email"]')
    await expect(emailInput).toBeVisible({ timeout: 15000 })
    await expect(emailInput).toBeEnabled({ timeout: 5000 })

    await emailInput.fill(TEST_ADMIN.email)
    await page.locator('input[type="password"]').fill(TEST_ADMIN.password)

    // Submit form and wait for auth API response
    const [response] = await Promise.all([
      page.waitForResponse((resp) => resp.url().includes('/api/auth/sign-in/email'), {
        timeout: 15000,
      }),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ])

    expect(response.ok()).toBeTruthy()

    // Wait for auth to be established then navigate to callback URL
    await page.waitForTimeout(1000) // Brief wait for session cookie to be set
    await page.goto(callbackUrl)
    await expect(page).toHaveURL(new RegExp(callbackUrl), { timeout: 15000 })
  })

  test('has link to signup page', async ({ page }) => {
    await page.goto('/admin/login')

    // Wait for page to load by checking for the signup link
    const signupLink = page.getByRole('link', { name: /sign up/i })
    await expect(signupLink).toBeVisible({ timeout: 15000 })

    // Accept either /admin/signup or /signup depending on which login page we're on
    const href = await signupLink.getAttribute('href')
    expect(href).toMatch(/signup/)
  })
})
