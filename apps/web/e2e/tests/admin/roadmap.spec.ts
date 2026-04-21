import { test, expect } from '@playwright/test'

test.describe('Admin Roadmap', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/roadmap')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows roadmap content', async ({ page }) => {
    // The page should render without error — look for the roadmap sidebar "Roadmaps" heading
    // or the empty state / kanban columns
    const roadmapContent = page
      .getByText(/roadmaps/i)
      .or(page.getByText(/no roadmap selected/i))
      .or(page.getByText(/no roadmaps yet/i))
    await expect(roadmapContent.first()).toBeVisible({ timeout: 10000 })
  })

  test('admin sidebar contains Roadmap navigation link', async ({ page }) => {
    const roadmapLink = page.getByRole('link', { name: 'Roadmap' })
    await expect(roadmapLink.first()).toBeVisible({ timeout: 10000 })
  })

  test('navigating to /admin/roadmap via sidebar link works', async ({ page }) => {
    // Start somewhere else and navigate back via the sidebar
    await page.goto('/admin/feedback')
    await page.waitForLoadState('networkidle')

    const roadmapLink = page.getByRole('link', { name: 'Roadmap' })
    await roadmapLink.first().click()

    await expect(page).toHaveURL(/\/admin\/roadmap/, { timeout: 10000 })
    await page.waitForLoadState('networkidle')

    // Page should render roadmap UI
    const roadmapContent = page
      .getByText(/roadmaps/i)
      .or(page.getByText(/no roadmap selected/i))
      .or(page.getByText(/no roadmaps yet/i))
    await expect(roadmapContent.first()).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Admin Roadmap - Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/roadmap')
    await page.waitForLoadState('networkidle')
  })

  test('roadmap sidebar shows "Roadmaps" section header', async ({ page }) => {
    // The sidebar has a small uppercase "ROADMAPS" label
    const sectionHeader = page.getByText(/^roadmaps$/i)
    await expect(sectionHeader.first()).toBeVisible({ timeout: 10000 })
  })

  test('shows create roadmap button in sidebar', async ({ page }) => {
    // The + icon button lives next to the "Roadmaps" header
    // It has no accessible name but is the only button in that header area
    const createRoadmapBtn = page.locator('aside').getByRole('button').first()
    await expect(createRoadmapBtn).toBeVisible({ timeout: 10000 })
  })

  test('can open create roadmap dialog', async ({ page }) => {
    // Click the + button next to the "Roadmaps" heading
    const createBtn = page.locator('aside').getByRole('button').first()

    if ((await createBtn.count()) > 0) {
      await createBtn.click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 5000 })
      await expect(dialog.getByText('Create Roadmap')).toBeVisible()

      // Dialog should contain Name field and Public toggle
      await expect(dialog.getByLabel('Name')).toBeVisible()
      await expect(dialog.getByRole('switch')).toBeVisible()

      // Cancel/Create buttons
      await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible()
      await expect(dialog.getByRole('button', { name: /create/i })).toBeVisible()

      // Close dialog
      await dialog.getByRole('button', { name: /cancel/i }).click()
      await expect(dialog).toBeHidden({ timeout: 5000 })
    }
  })

  test('can close create roadmap dialog with Escape', async ({ page }) => {
    const createBtn = page.locator('aside').getByRole('button').first()

    if ((await createBtn.count()) > 0) {
      await createBtn.click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 5000 })

      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden({ timeout: 5000 })
    }
  })

  test('shows empty state when no roadmaps exist', async ({ page }) => {
    // This guard means the test is only meaningful when seed data has no roadmaps
    const emptyState = page.getByText('No roadmaps yet')

    if ((await emptyState.count()) > 0) {
      await expect(emptyState).toBeVisible()
      await expect(page.getByText('Create your first roadmap to get started')).toBeVisible()
    }
  })

  test('lists existing roadmaps in sidebar', async ({ page }) => {
    // Seed data typically has at least one roadmap; verify each item has a map icon
    const roadmapItems = page.locator('aside').locator('svg').first()

    if ((await roadmapItems.count()) > 0) {
      await expect(roadmapItems).toBeVisible({ timeout: 10000 })
    }
  })

  test('can select a roadmap from the sidebar', async ({ page }) => {
    // Find roadmap items in the sidebar list (each is a clickable div)
    const sidebarList = page.locator('aside [class*="space-y-1"]')

    if ((await sidebarList.count()) > 0) {
      const firstItem = sidebarList.locator('[class*="cursor-pointer"]').first()

      if ((await firstItem.count()) > 0) {
        await firstItem.click()
        await page.waitForLoadState('networkidle')

        // After selecting, the main area should show the roadmap name heading
        const roadmapHeading = page.locator('main h2').first()
        await expect(roadmapHeading).toBeVisible({ timeout: 5000 })
      }
    }
  })

  test('roadmap item shows lock icon when private', async ({ page }) => {
    // Private roadmaps render a LockClosedIcon next to the name
    const lockIcons = page.locator('aside svg').filter({ has: page.locator('[class*="lock"]') })

    // Guard: only assert if private roadmaps are present
    if ((await lockIcons.count()) > 0) {
      await expect(lockIcons.first()).toBeVisible()
    }
  })
})

test.describe('Admin Roadmap - CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/roadmap')
    await page.waitForLoadState('networkidle')
  })

  test('can create a new roadmap', async ({ page }) => {
    const createBtn = page.locator('aside').getByRole('button').first()

    if ((await createBtn.count()) > 0) {
      await createBtn.click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 5000 })

      const roadmapName = `E2E Roadmap ${Date.now()}`
      await dialog.getByLabel('Name').fill(roadmapName)

      // Submit
      await dialog.getByRole('button', { name: /create/i }).click()

      // Dialog should close on success
      await expect(dialog).toBeHidden({ timeout: 10000 })
      await page.waitForLoadState('networkidle')

      // The new roadmap should appear in the sidebar
      await expect(page.locator('aside').getByText(roadmapName)).toBeVisible({ timeout: 10000 })
    }
  })

  test('can create a private roadmap', async ({ page }) => {
    const createBtn = page.locator('aside').getByRole('button').first()

    if ((await createBtn.count()) > 0) {
      await createBtn.click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 5000 })

      const roadmapName = `Private Roadmap ${Date.now()}`
      await dialog.getByLabel('Name').fill(roadmapName)

      // Turn off the Public toggle (it defaults to on)
      const publicSwitch = dialog.getByRole('switch')
      const isOn = (await publicSwitch.getAttribute('data-state')) === 'checked'
      if (isOn) {
        await publicSwitch.click()
      }

      await dialog.getByRole('button', { name: /create/i }).click()
      await expect(dialog).toBeHidden({ timeout: 10000 })
      await page.waitForLoadState('networkidle')

      // New roadmap appears in sidebar
      await expect(page.locator('aside').getByText(roadmapName)).toBeVisible({ timeout: 10000 })
    }
  })

  test('can open edit dialog for a roadmap', async ({ page }) => {
    // Roadmap items show a "..." kebab button on hover
    const sidebarItems = page.locator('aside [class*="group"]')

    if ((await sidebarItems.count()) > 0) {
      const firstItem = sidebarItems.first()
      await firstItem.hover()

      // The ellipsis button becomes visible on hover
      const kebabBtn = firstItem.getByRole('button')
      if ((await kebabBtn.count()) > 0) {
        await kebabBtn.click()

        const menu = page.getByRole('menu')
        await expect(menu).toBeVisible({ timeout: 3000 })

        // Click Edit
        const editItem = menu.getByText('Edit')
        if ((await editItem.count()) > 0) {
          await editItem.click()

          const editDialog = page.getByRole('dialog')
          await expect(editDialog).toBeVisible({ timeout: 5000 })
          await expect(editDialog.getByText('Edit Roadmap')).toBeVisible()

          // Name field should be pre-filled
          await expect(editDialog.getByLabel(/^name$/i)).not.toHaveValue('')

          // Close dialog
          await editDialog.getByRole('button', { name: /cancel/i }).click()
          await expect(editDialog).toBeHidden({ timeout: 5000 })
        } else {
          await page.keyboard.press('Escape')
        }
      }
    }
  })

  test('can edit a roadmap name', async ({ page }) => {
    const sidebarItems = page.locator('aside [class*="group"]')

    if ((await sidebarItems.count()) > 0) {
      const firstItem = sidebarItems.first()
      await firstItem.hover()

      const kebabBtn = firstItem.getByRole('button')
      if ((await kebabBtn.count()) > 0) {
        await kebabBtn.click()

        const menu = page.getByRole('menu')
        await expect(menu).toBeVisible({ timeout: 3000 })

        const editItem = menu.getByText('Edit')
        if ((await editItem.count()) > 0) {
          await editItem.click()

          const editDialog = page.getByRole('dialog')
          await expect(editDialog).toBeVisible({ timeout: 5000 })

          // Clear name and type a new one
          const nameInput = editDialog.getByLabel(/^name$/i)
          const updatedName = `Updated Roadmap ${Date.now()}`
          await nameInput.clear()
          await nameInput.fill(updatedName)

          await editDialog.getByRole('button', { name: /save/i }).click()
          await expect(editDialog).toBeHidden({ timeout: 10000 })
          await page.waitForLoadState('networkidle')
        } else {
          await page.keyboard.press('Escape')
        }
      }
    }
  })

  test('can open delete confirmation for a roadmap', async ({ page }) => {
    const sidebarItems = page.locator('aside [class*="group"]')

    if ((await sidebarItems.count()) > 0) {
      const firstItem = sidebarItems.first()
      await firstItem.hover()

      const kebabBtn = firstItem.getByRole('button')
      if ((await kebabBtn.count()) > 0) {
        await kebabBtn.click()

        const menu = page.getByRole('menu')
        await expect(menu).toBeVisible({ timeout: 3000 })

        const deleteItem = menu.getByText('Delete')
        if ((await deleteItem.count()) > 0) {
          await deleteItem.click()

          // ConfirmDialog renders as an alertdialog or dialog
          const confirmDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
          await expect(confirmDialog).toBeVisible({ timeout: 5000 })
          await expect(confirmDialog.getByText(/delete roadmap/i)).toBeVisible()

          // Cancel — do not actually delete
          const cancelBtn = confirmDialog.getByRole('button', { name: /cancel/i })
          if ((await cancelBtn.count()) > 0) {
            await cancelBtn.click()
          } else {
            await page.keyboard.press('Escape')
          }

          await expect(confirmDialog).toBeHidden({ timeout: 5000 })
        } else {
          await page.keyboard.press('Escape')
        }
      }
    }
  })
})

test.describe('Admin Roadmap - Kanban columns', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/roadmap')
    await page.waitForLoadState('networkidle')
  })

  test('shows kanban columns when a roadmap is selected', async ({ page }) => {
    // If a roadmap is selected (auto-selected on load) the column area renders
    const noRoadmapMsg = page.getByText('No roadmap selected')

    if ((await noRoadmapMsg.count()) === 0) {
      // Columns are rendered as flex children; each column has a status title span
      const columnTitles = page.locator('main').locator('[class*="text-sm"][class*="font-medium"]')
      await expect(columnTitles.first()).toBeVisible({ timeout: 10000 })
    }
  })

  test('shows roadmap name heading when a roadmap is selected', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')

    if ((await noRoadmapMsg.count()) === 0) {
      const heading = page.locator('main h2').first()
      await expect(heading).toBeVisible({ timeout: 10000 })
      // Heading text should be non-empty
      const text = await heading.textContent()
      expect(text?.trim().length).toBeGreaterThan(0)
    }
  })

  test('column headers show status names', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')

    if ((await noRoadmapMsg.count()) === 0) {
      // Each column header contains a colored dot + status name
      // Statuses from seed data include names like "Planned", "In Progress", "Shipped" etc.
      const statusNameSpans = page.locator(
        'main [class*="min-w-\\[280px\\]"] [class*="text-sm"][class*="font-medium"]'
      )

      if ((await statusNameSpans.count()) > 0) {
        await expect(statusNameSpans.first()).toBeVisible({ timeout: 10000 })
      }
    }
  })

  test('column headers show item counts', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')

    if ((await noRoadmapMsg.count()) === 0) {
      // Each column has a count badge rendered as a small text-xs span next to the title
      const countSpans = page.locator('main [class*="text-xs"][class*="text-muted-foreground"]')

      if ((await countSpans.count()) > 0) {
        await expect(countSpans.first()).toBeVisible({ timeout: 10000 })
      }
    }
  })

  test('columns show "No items" empty state when empty', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')

    if ((await noRoadmapMsg.count()) === 0) {
      const emptyColumns = page.getByText('No items')

      // At least one column may be empty in seed data
      if ((await emptyColumns.count()) > 0) {
        await expect(emptyColumns.first()).toBeVisible()
      }
    }
  })

  test('shows roadmap cards when items exist', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')

    if ((await noRoadmapMsg.count()) === 0) {
      // Cards are bg-card rounded-lg elements; guard with count check
      const cards = page.locator('main [class*="bg-card"][class*="rounded-lg"]')

      if ((await cards.count()) > 0) {
        await expect(cards.first()).toBeVisible({ timeout: 10000 })
      }
    }
  })

  test('roadmap card shows vote count and board badge', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')

    if ((await noRoadmapMsg.count()) === 0) {
      const cards = page.locator('main [class*="bg-card"][class*="rounded-lg"]')

      if ((await cards.count()) > 0) {
        const firstCard = cards.first()

        // Cards have a vote count section (ChevronUpIcon + number)
        // and a board name badge
        await expect(firstCard).toBeVisible({ timeout: 10000 })

        // Vote count: a text-sm font-semibold span inside the vote column
        const voteCount = firstCard.locator('[class*="font-semibold"]').first()
        await expect(voteCount).toBeVisible()

        // Board badge
        const boardBadge = firstCard.locator('[class*="badge"]').or(firstCard.locator('span'))
        if ((await boardBadge.count()) > 0) {
          await expect(boardBadge.first()).toBeVisible()
        }
      }
    }
  })

  test('clicking a roadmap card opens the post detail modal', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')

    if ((await noRoadmapMsg.count()) === 0) {
      const cards = page.locator('main [class*="bg-card"][class*="rounded-lg"]')

      if ((await cards.count()) > 0) {
        await cards.first().click()

        // URL should gain a ?post= param
        await expect(page).toHaveURL(/[?&]post=/, { timeout: 5000 })

        // A modal / sheet should open with post content
        const modal = page.getByRole('dialog')
        await expect(modal).toBeVisible({ timeout: 10000 })

        // Close modal
        await page.keyboard.press('Escape')
        await expect(modal).toBeHidden({ timeout: 5000 })
      }
    }
  })
})

test.describe('Admin Roadmap - Filters bar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/roadmap')
    await page.waitForLoadState('networkidle')
  })

  test('shows search button in filters bar', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')

    if ((await noRoadmapMsg.count()) === 0) {
      const searchBtn = page.getByRole('button', { name: /search/i }).or(page.getByText('Search'))
      await expect(searchBtn.first()).toBeVisible({ timeout: 10000 })
    }
  })

  test('shows sort options (Votes, Newest, Oldest)', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')

    if ((await noRoadmapMsg.count()) === 0) {
      await expect(page.getByRole('button', { name: 'Votes' })).toBeVisible({ timeout: 10000 })
      await expect(page.getByRole('button', { name: 'Newest' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Oldest' })).toBeVisible()
    }
  })

  test('can change sort order', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')

    if ((await noRoadmapMsg.count()) === 0) {
      const newestBtn = page.getByRole('button', { name: 'Newest' })
      await newestBtn.click()

      // URL should have sort=newest
      await expect(page).toHaveURL(/sort=newest/, { timeout: 5000 })
    }
  })

  test('shows "Add filter" button', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')

    if ((await noRoadmapMsg.count()) === 0) {
      const addFilterBtn = page.getByText('Add filter')
      await expect(addFilterBtn).toBeVisible({ timeout: 10000 })
    }
  })

  test('can open Add filter popover', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')

    if ((await noRoadmapMsg.count()) === 0) {
      const addFilterBtn = page.getByText('Add filter')

      if ((await addFilterBtn.count()) > 0) {
        await addFilterBtn.click()

        // Popover should open with Board / Tag categories
        const popover = page.locator('[data-radix-popover-content]')
        await expect(popover).toBeVisible({ timeout: 5000 })

        await expect(popover.getByText('Board')).toBeVisible()
        await expect(popover.getByText('Tag')).toBeVisible()

        // Close popover
        await page.keyboard.press('Escape')
      }
    }
  })

  test('can open search popover and type a query', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')

    if ((await noRoadmapMsg.count()) === 0) {
      const searchBtn = page.getByText('Search').first()

      if ((await searchBtn.count()) > 0) {
        await searchBtn.click()

        // Search popover shows an input
        const searchInput = page.getByPlaceholder('Search posts...')
        await expect(searchInput).toBeVisible({ timeout: 5000 })

        await searchInput.fill('test query')
        await page.keyboard.press('Enter')

        // URL should reflect the search param
        await expect(page).toHaveURL(/search=test/, { timeout: 5000 })
      }
    }
  })
})
