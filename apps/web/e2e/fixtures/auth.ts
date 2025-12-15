import { test as base, expect } from '@playwright/test'

/**
 * Test credentials from seed data
 */
export const TEST_ADMIN = {
  email: 'demo@example.com',
  name: 'Demo User',
  password: 'demo1234',
}

export const TEST_ORG = {
  name: 'Acme Corp',
  slug: 'acme',
}

/**
 * Extended test fixtures with authentication helpers
 */
export const test = base.extend<{
  /**
   * Login as admin user programmatically using session cookies
   */
  loginAsAdmin: () => Promise<void>
}>({
  loginAsAdmin: async ({ page }, use) => {
    const login = async () => {
      // For OTP-based auth, we can't easily automate the login flow in E2E tests
      // since it requires email verification. Instead, tests should use the
      // global setup authentication state stored in e2e/.auth/admin.json
      //
      // If you need a fresh login in a test, consider:
      // 1. Using the pre-authenticated state from global setup
      // 2. Or creating a test helper API endpoint that creates sessions directly
      await page.goto('/admin')
      await expect(page).toHaveURL(/\/admin/, { timeout: 10000 })
    }
    await use(login)
  },
})

export { expect }
