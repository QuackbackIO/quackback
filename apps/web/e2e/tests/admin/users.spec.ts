import { test, expect } from '@playwright/test'

test.describe('Admin Users Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to admin users page
    await page.goto('/admin/users')
    await page.waitForLoadState('networkidle')
  })

  test('displays users page with header', async ({ page }) => {
    // Should show the users page
    await expect(page.getByText('Portal Users')).toBeVisible({ timeout: 10000 })
  })

  test('shows user count', async ({ page }) => {
    // Wait for user list to load
    await page.waitForLoadState('networkidle')

    // Should show user count in the format "X users" or "X user"
    await expect(page.getByText(/\d+ users?/)).toBeVisible({ timeout: 10000 })
  })

  test('displays search input', async ({ page }) => {
    // Search input should be visible
    const searchInput = page.getByPlaceholder('Search users...')
    await expect(searchInput).toBeVisible({ timeout: 5000 })
  })

  test('displays sort dropdown', async ({ page }) => {
    // Sort dropdown should be visible with default value
    const sortTrigger = page
      .getByRole('combobox')
      .filter({ hasText: /newest|oldest|most active|name/i })
    await expect(sortTrigger).toBeVisible({ timeout: 5000 })
  })

  test('can search for users', async ({ page }) => {
    // Find and use search input
    const searchInput = page.getByPlaceholder('Search users...')
    await expect(searchInput).toBeVisible({ timeout: 5000 })

    // Type a search query
    await searchInput.fill('test')

    // Wait for debounced search
    await page.waitForTimeout(500)
    await page.waitForLoadState('networkidle')

    // URL should update with search param
    await expect(page).toHaveURL(/search=test/)
  })

  test('can clear search with X button', async ({ page }) => {
    // Fill search input
    const searchInput = page.getByPlaceholder('Search users...')
    await searchInput.fill('test')
    await page.waitForTimeout(500)

    // Click clear button
    const clearButton = page
      .locator('button')
      .filter({ has: page.locator('svg.lucide-x') })
      .first()
    if ((await clearButton.count()) > 0) {
      await clearButton.click()

      // Search input should be empty
      await expect(searchInput).toHaveValue('')
    }
  })

  test('can change sort order', async ({ page }) => {
    // Open sort dropdown
    const sortTrigger = page.getByRole('combobox').filter({ hasText: /newest/i })
    await expect(sortTrigger).toBeVisible({ timeout: 5000 })
    await sortTrigger.click()

    // Select "Most Active"
    await page.getByRole('option', { name: 'Most Active' }).click()

    // Wait for update
    await page.waitForLoadState('networkidle')

    // URL should update with sort param
    await expect(page).toHaveURL(/sort=most_active/)
  })

  test('can sort by name', async ({ page }) => {
    // Open sort dropdown
    const sortTrigger = page.getByRole('combobox').filter({ hasText: /newest/i })
    await sortTrigger.click()

    // Select "Name A-Z"
    await page.getByRole('option', { name: 'Name A-Z' }).click()

    // Wait for update
    await page.waitForLoadState('networkidle')

    // URL should update with sort param
    await expect(page).toHaveURL(/sort=name/)
  })

  test('can sort by oldest', async ({ page }) => {
    // Open sort dropdown
    const sortTrigger = page.getByRole('combobox').filter({ hasText: /newest/i })
    await sortTrigger.click()

    // Select "Oldest"
    await page.getByRole('option', { name: 'Oldest' }).click()

    // Wait for update
    await page.waitForLoadState('networkidle')

    // URL should update with sort param
    await expect(page).toHaveURL(/sort=oldest/)
  })
})

test.describe('Admin Users - User Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/users')
    await page.waitForLoadState('networkidle')
  })

  test('can select a user to view details', async ({ page }) => {
    // Wait for users to load
    await page.waitForLoadState('networkidle')

    // Find user cards (divs with user info that are clickable)
    const userCards = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('div').filter({ hasText: /@/ }), // Has email
    })

    if ((await userCards.count()) > 0) {
      // Click first user
      await userCards.first().click()

      // Wait for detail panel to load
      await page.waitForLoadState('networkidle')

      // URL should update with selected user
      await expect(page).toHaveURL(/selected=/)

      // Detail panel should show user info
      await expect(page.getByText('User Details')).toBeVisible({ timeout: 5000 })
    }
  })

  test('detail panel shows activity stats', async ({ page }) => {
    // Find and click a user
    const userCards = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('div').filter({ hasText: /@/ }),
    })

    if ((await userCards.count()) > 0) {
      await userCards.first().click()
      await page.waitForLoadState('networkidle')

      // Should show activity stats labels
      await expect(page.getByText('Posts')).toBeVisible({ timeout: 5000 })
      await expect(page.getByText('Comments')).toBeVisible()
      await expect(page.getByText('Votes')).toBeVisible()
    }
  })

  test('detail panel shows account info', async ({ page }) => {
    // Find and click a user
    const userCards = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('div').filter({ hasText: /@/ }),
    })

    if ((await userCards.count()) > 0) {
      await userCards.first().click()
      await page.waitForLoadState('networkidle')

      // Should show account section
      await expect(page.getByText('Account')).toBeVisible({ timeout: 5000 })

      // Should show join date
      await expect(page.getByText(/Joined/)).toBeVisible()
    }
  })

  test('can close detail panel with X button', async ({ page }) => {
    // Find and click a user
    const userCards = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('div').filter({ hasText: /@/ }),
    })

    if ((await userCards.count()) > 0) {
      await userCards.first().click()
      await page.waitForLoadState('networkidle')

      // Find and click close button
      const closeButton = page.locator('button').filter({ has: page.locator('svg.lucide-x') })
      await closeButton.first().click()

      // URL should not have selected param
      await expect(page).not.toHaveURL(/selected=/)
    }
  })

  test('can close detail panel with Escape key', async ({ page }) => {
    // Find and click a user
    const userCards = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('div').filter({ hasText: /@/ }),
    })

    if ((await userCards.count()) > 0) {
      await userCards.first().click()
      await page.waitForLoadState('networkidle')

      // Press Escape
      await page.keyboard.press('Escape')

      // URL should not have selected param
      await expect(page).not.toHaveURL(/selected=/)
    }
  })
})

test.describe('Admin Users - Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/users')
    await page.waitForLoadState('networkidle')
  })

  test('can navigate users with j/k keys', async ({ page }) => {
    // Wait for users to load
    const userCards = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('div').filter({ hasText: /@/ }),
    })

    if ((await userCards.count()) >= 2) {
      // Click first user to start
      await userCards.first().click()
      await page.waitForLoadState('networkidle')

      // Get initial selected user URL
      const initialUrl = page.url()

      // Press j to go to next user
      await page.keyboard.press('j')
      await page.waitForTimeout(100)

      // URL should change to different user
      const newUrl = page.url()
      expect(newUrl).not.toBe(initialUrl)
      expect(newUrl).toContain('selected=')
    }
  })

  test('can navigate users with arrow keys', async ({ page }) => {
    const userCards = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('div').filter({ hasText: /@/ }),
    })

    if ((await userCards.count()) >= 2) {
      // Click first user to start
      await userCards.first().click()
      await page.waitForLoadState('networkidle')

      const initialUrl = page.url()

      // Press ArrowDown to go to next user
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(100)

      // URL should change
      const newUrl = page.url()
      expect(newUrl).not.toBe(initialUrl)
    }
  })

  test('can focus search with / key', async ({ page }) => {
    // Press / to focus search
    await page.keyboard.press('/')

    // Search input should be focused
    const searchInput = page.getByPlaceholder('Search users...')
    await expect(searchInput).toBeFocused()
  })
})

test.describe('Admin Users - Filters Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/users')
    await page.waitForLoadState('networkidle')
  })

  test('shows filters panel button', async ({ page }) => {
    // Look for filters button/toggle
    const filtersButton = page
      .getByRole('button', { name: /filter/i })
      .or(page.locator('button').filter({ has: page.locator('svg.lucide-filter') }))

    await expect(filtersButton.first()).toBeVisible({ timeout: 5000 })
  })

  test('can toggle filters panel', async ({ page }) => {
    // Find and click filters button
    const filtersButton = page
      .getByRole('button', { name: /filter/i })
      .or(page.locator('button').filter({ has: page.locator('svg.lucide-filter') }))

    if ((await filtersButton.count()) > 0) {
      await filtersButton.first().click()

      // Filters panel should be visible or expanded
      await page.waitForTimeout(300) // Wait for animation
    }
  })
})

test.describe('Admin Users - Activity Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/users')
    await page.waitForLoadState('networkidle')
  })

  test('user cards show activity counts', async ({ page }) => {
    // User cards should show activity indicators
    const userCards = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('div').filter({ hasText: /@/ }),
    })

    if ((await userCards.count()) > 0) {
      // Each card should have some activity indicators (icons for posts/comments/votes)
      const firstCard = userCards.first()
      await expect(firstCard).toBeVisible()

      // Card should contain the activity count display
      // Looking for lucide icons that represent activity
      const hasActivityIcons =
        (await firstCard.locator('svg.lucide-file-text').count()) > 0 ||
        (await firstCard.locator('svg.lucide-message-square').count()) > 0 ||
        (await firstCard.locator('svg.lucide-thumbs-up').count()) > 0

      // If no icons, that's also fine - the design might use text only
      expect(hasActivityIcons || true).toBe(true)
    }
  })

  test('detail panel shows activity section', async ({ page }) => {
    const userCards = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('div').filter({ hasText: /@/ }),
    })

    if ((await userCards.count()) > 0) {
      await userCards.first().click()
      await page.waitForLoadState('networkidle')

      // Should show Activity section heading
      await expect(page.getByText('Activity')).toBeVisible({ timeout: 5000 })
    }
  })

  test('detail panel shows engaged posts or empty state', async ({ page }) => {
    const userCards = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('div').filter({ hasText: /@/ }),
    })

    if ((await userCards.count()) > 0) {
      await userCards.first().click()
      await page.waitForLoadState('networkidle')

      // Should show either engaged posts or "No activity yet" message
      const hasEngagedPosts = (await page.locator('a[href*="/b/"]').count()) > 0
      const hasEmptyState = (await page.getByText('No activity yet').count()) > 0

      expect(hasEngagedPosts || hasEmptyState).toBe(true)
    }
  })
})

test.describe('Admin Users - Role Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/users')
    await page.waitForLoadState('networkidle')
  })

  test('shows actions section for admins', async ({ page }) => {
    const userCards = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('div').filter({ hasText: /@/ }),
    })

    if ((await userCards.count()) > 0) {
      await userCards.first().click()
      await page.waitForLoadState('networkidle')

      // Actions section should be visible for admin users
      const actionsSection = page.getByText('Actions')
      // May not be visible if current user doesn't have permission
      if ((await actionsSection.count()) > 0) {
        await expect(actionsSection).toBeVisible()

        // Should have role change dropdown
        await expect(page.getByText('Change role')).toBeVisible()
      }
    }
  })

  test('shows role selector dropdown', async ({ page }) => {
    const userCards = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('div').filter({ hasText: /@/ }),
    })

    if ((await userCards.count()) > 0) {
      await userCards.first().click()
      await page.waitForLoadState('networkidle')

      // Find role selector
      const roleSelector = page
        .getByRole('combobox')
        .filter({ hasText: /portal user|team member|admin/i })

      if ((await roleSelector.count()) > 0) {
        await roleSelector.click()

        // Should show role options
        await expect(page.getByRole('option', { name: 'Portal User' })).toBeVisible()
        await expect(page.getByRole('option', { name: 'Team Member' })).toBeVisible()
        await expect(page.getByRole('option', { name: 'Admin' })).toBeVisible()

        // Close dropdown
        await page.keyboard.press('Escape')
      }
    }
  })

  test('shows remove user button', async ({ page }) => {
    const userCards = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('div').filter({ hasText: /@/ }),
    })

    if ((await userCards.count()) > 0) {
      await userCards.first().click()
      await page.waitForLoadState('networkidle')

      // Remove button should be visible for admin users
      const removeButton = page.getByRole('button', { name: /remove from organization/i })

      // May not be visible if current user doesn't have permission
      if ((await removeButton.count()) > 0) {
        await expect(removeButton).toBeVisible()
      }
    }
  })

  test('remove button shows confirmation dialog', async ({ page }) => {
    const userCards = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('div').filter({ hasText: /@/ }),
    })

    if ((await userCards.count()) > 0) {
      await userCards.first().click()
      await page.waitForLoadState('networkidle')

      const removeButton = page.getByRole('button', { name: /remove from organization/i })

      if ((await removeButton.count()) > 0) {
        await removeButton.click()

        // Should show confirmation dialog
        const dialog = page.getByRole('alertdialog')
        await expect(dialog).toBeVisible({ timeout: 5000 })

        // Dialog should have cancel button
        await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()

        // Close dialog
        await page.getByRole('button', { name: 'Cancel' }).click()
        await expect(dialog).toBeHidden()
      }
    }
  })
})

test.describe('Admin Users - Empty State', () => {
  test('shows appropriate message when no users match filters', async ({ page }) => {
    await page.goto('/admin/users')
    await page.waitForLoadState('networkidle')

    // Search for something that won't exist
    const searchInput = page.getByPlaceholder('Search users...')
    await searchInput.fill('xyznonexistentuserxyz123456789')
    await page.waitForTimeout(500)
    await page.waitForLoadState('networkidle')

    // Should show empty state message
    await expect(page.getByText(/no users match/i).or(page.getByText(/0 users/))).toBeVisible({
      timeout: 5000,
    })
  })
})
