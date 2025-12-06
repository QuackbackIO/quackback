import { test as base, expect } from '@playwright/test'

/**
 * Test credentials from seed data
 */
export const TEST_ADMIN = {
  email: 'demo@example.com',
  password: 'demo1234',
  name: 'Demo User',
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
   * Login as admin user programmatically
   */
  loginAsAdmin: () => Promise<void>
}>({
  loginAsAdmin: async ({ page }, use) => {
    const login = async () => {
      await page.goto('/admin/login')
      await page.getByLabel('Email').fill(TEST_ADMIN.email)
      await page.getByLabel('Password').fill(TEST_ADMIN.password)
      await page.getByRole('button', { name: /sign in/i }).click()
      await expect(page).toHaveURL(/\/admin/, { timeout: 10000 })
    }
    await use(login)
  },
})

export { expect }
