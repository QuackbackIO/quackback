import { test as setup, expect } from '@playwright/test'

const ADMIN_EMAIL = 'demo@example.com'
const ADMIN_PASSWORD = 'demo1234'
const AUTH_FILE = 'e2e/.auth/admin.json'

/**
 * Global setup: Authenticate as admin and save session state
 */
setup('authenticate as admin', async ({ page }) => {
  // Navigate to admin login
  await page.goto('/admin/login')

  // Wait for form to load (wrapped in Suspense)
  await page.waitForSelector('input[type="email"]', { timeout: 10000 })

  // Fill login form
  await page.locator('input[type="email"]').fill(ADMIN_EMAIL)
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD)

  // Submit form and wait for the auth API response
  const [response] = await Promise.all([
    page.waitForResponse((resp) => resp.url().includes('/api/auth/sign-in/email')),
    page.getByRole('button', { name: 'Sign in', exact: true }).click(),
  ])

  // Check if login was successful
  expect(response.ok()).toBeTruthy()

  // Wait for navigation to complete and session cookie to be set
  await page.waitForLoadState('networkidle')

  // Navigate to admin dashboard explicitly
  await page.goto('/admin')
  await page.waitForLoadState('networkidle')

  // Verify we're on admin page (not redirected back to login)
  await expect(page).toHaveURL(/\/admin/, { timeout: 10000 })

  // Save authentication state
  await page.context().storageState({ path: AUTH_FILE })
})
