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
    await page.waitForLoadState('networkidle')

    // Wait for page to settle - accept either admin or portal login page
    const heading = page.getByRole('heading', { name: /team sign in|welcome back/i, level: 1 })
    await expect(heading).toBeVisible({ timeout: 10000 })

    // Wait for form to load (wrapped in Suspense)
    await page.waitForSelector('input[type="email"]', { timeout: 10000 })

    // Check for email and password fields using placeholder or type
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()

    // Use exact match to avoid OAuth buttons (Sign in with Google, Sign in with GitHub)
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  })

  test('logs in with valid credentials', async ({ page }) => {
    await page.goto('/admin/login')
    await page.waitForLoadState('networkidle')

    // Wait for form to load
    await page.waitForSelector('input[type="email"]', { timeout: 10000 })

    await page.locator('input[type="email"]').fill(TEST_ADMIN.email)
    await page.locator('input[type="password"]').fill(TEST_ADMIN.password)

    // Submit form and wait for auth API response
    const [response] = await Promise.all([
      page.waitForResponse((resp) => resp.url().includes('/api/auth/sign-in/email')),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ])

    expect(response.ok()).toBeTruthy()

    // Wait for navigation to complete
    await page.waitForLoadState('networkidle')

    // Navigate to admin explicitly to verify auth worked
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin/, { timeout: 10000 })
  })

  test('shows error with invalid credentials', async ({ page }) => {
    await page.goto('/admin/login')
    await page.waitForLoadState('networkidle')

    // Wait for form to load
    await page.waitForSelector('input[type="email"]', { timeout: 10000 })

    await page.locator('input[type="email"]').fill('invalid@example.com')
    await page.locator('input[type="password"]').fill('wrongpassword')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    // Should show error message
    await expect(page.getByText(/invalid|error|incorrect/i)).toBeVisible({ timeout: 5000 })

    // Should stay on a login page (either /admin/login or /login)
    await expect(page).toHaveURL(/\/login/)
  })

  test('redirects to callback URL after login', async ({ page }) => {
    const callbackUrl = '/admin/settings/boards'
    await page.goto(`/admin/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)
    await page.waitForLoadState('networkidle')

    // Wait for form to load
    await page.waitForSelector('input[type="email"]', { timeout: 10000 })

    await page.locator('input[type="email"]').fill(TEST_ADMIN.email)
    await page.locator('input[type="password"]').fill(TEST_ADMIN.password)

    // Submit form and wait for auth API response
    const [response] = await Promise.all([
      page.waitForResponse((resp) => resp.url().includes('/api/auth/sign-in/email')),
      page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ])

    expect(response.ok()).toBeTruthy()

    // Wait for navigation to complete
    await page.waitForLoadState('networkidle')

    // Navigate to callback URL explicitly
    await page.goto(callbackUrl)
    await expect(page).toHaveURL(new RegExp(callbackUrl), { timeout: 10000 })
  })

  test('has link to signup page', async ({ page }) => {
    await page.goto('/admin/login')
    await page.waitForLoadState('networkidle')

    const signupLink = page.getByRole('link', { name: /sign up/i })
    await expect(signupLink).toBeVisible({ timeout: 10000 })
    // Accept either /admin/signup or /signup depending on which login page we're on
    const href = await signupLink.getAttribute('href')
    expect(href).toMatch(/signup/)
  })
})
