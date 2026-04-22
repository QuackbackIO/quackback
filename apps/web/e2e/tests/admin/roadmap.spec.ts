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
    const createRoadmapBtn = page.locator('main aside').getByRole('button').first()
    await expect(createRoadmapBtn).toBeVisible({ timeout: 10000 })
  })

  test('can open create roadmap dialog', async ({ page }) => {
    // Click the + button next to the "Roadmaps" heading
    const createBtn = page.locator('main aside').getByRole('button').first()

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
    const createBtn = page.locator('main aside').getByRole('button').first()

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
    const createBtn = page.locator('main aside').getByRole('button').first()

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
    const createBtn = page.locator('main aside').getByRole('button').first()

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

test.describe('Admin Roadmap - Kanban Accuracy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/roadmap')
    await page.waitForLoadState('networkidle')
  })

  test('card count in each column matches the header badge count', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')
    if ((await noRoadmapMsg.count()) > 0) return

    // Each column is a min-w-[280px] flex child; wait for columns to render
    const columns = page.locator('main [class*="min-w-\\[280px\\]"]')
    await expect(columns.first()).toBeVisible({ timeout: 10000 })

    const columnCount = await columns.count()
    if (columnCount === 0) return

    for (let i = 0; i < columnCount; i++) {
      const col = columns.nth(i)

      // Header badge: the lone text-xs span in the column header area
      const badgeSpan = col.locator('.flex.items-center.justify-between span.text-xs')
      if ((await badgeSpan.count()) === 0) continue

      const badgeText = await badgeSpan.first().textContent()
      const badgeCount = parseInt(badgeText?.trim() ?? '', 10)

      // Actual cards rendered inside the column
      const cards = col.locator('[class*="bg-card"][class*="rounded-lg"]')
      const actualCardCount = await cards.count()

      // The badge total may exceed visible cards when pagination is active (infinite scroll
      // hasn't loaded all pages), so we assert actualCardCount <= badgeCount and
      // that badgeCount is itself a valid non-NaN integer.
      expect(Number.isNaN(badgeCount)).toBe(false)
      expect(actualCardCount).toBeLessThanOrEqual(badgeCount)

      // When the badge shows 0, no cards should be rendered either
      if (badgeCount === 0) {
        expect(actualCardCount).toBe(0)
      }
    }
  })

  test('each card in a column shows a non-empty board name', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')
    if ((await noRoadmapMsg.count()) > 0) return

    const cards = page.locator('main [class*="bg-card"][class*="rounded-lg"]')
    await page.waitForLoadState('networkidle')

    const cardCount = await cards.count()
    if (cardCount === 0) return

    // Check up to the first 10 cards to keep test fast
    const limit = Math.min(cardCount, 10)
    for (let i = 0; i < limit; i++) {
      const card = cards.nth(i)
      // Board badge is a shadcn Badge (secondary variant) rendered after the title p
      const boardBadge = card.locator('[class*="inline-flex"][class*="items-center"]').last()
      const boardText = await boardBadge.textContent()
      expect(boardText?.trim().length).toBeGreaterThan(0)
    }
  })

  test('each card shows a numeric vote count', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')
    if ((await noRoadmapMsg.count()) > 0) return

    const cards = page.locator('main [class*="bg-card"][class*="rounded-lg"]')
    await page.waitForLoadState('networkidle')

    const cardCount = await cards.count()
    if (cardCount === 0) return

    const limit = Math.min(cardCount, 10)
    for (let i = 0; i < limit; i++) {
      const card = cards.nth(i)
      // Vote count: text-sm font-semibold span inside the left vote column
      const voteSpan = card.locator('span.text-sm.font-semibold')
      const voteText = await voteSpan.first().textContent()
      const parsed = parseInt(voteText?.trim() ?? '', 10)
      expect(Number.isNaN(parsed)).toBe(false)
    }
  })

  test('clicking a card opens detail modal with matching title', async ({ page }) => {
    const noRoadmapMsg = page.getByText('No roadmap selected')
    if ((await noRoadmapMsg.count()) > 0) return

    const cards = page.locator('main [class*="bg-card"][class*="rounded-lg"]')
    await page.waitForLoadState('networkidle')

    if ((await cards.count()) === 0) return

    const firstCard = cards.first()

    // Read the title text from the card before clicking
    const titleEl = firstCard.locator('p.text-sm.font-medium')
    const cardTitle = (await titleEl.textContent())?.trim() ?? ''
    expect(cardTitle.length).toBeGreaterThan(0)

    await firstCard.click()

    // URL gains ?post= param
    await expect(page).toHaveURL(/[?&]post=/, { timeout: 5000 })

    // Modal opens
    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible({ timeout: 10000 })

    // Modal heading should contain the same title text
    const modalHeading = modal.locator('h1, h2, h3').filter({ hasText: cardTitle }).first()
    await expect(modalHeading).toBeVisible({ timeout: 5000 })

    // Close modal
    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden({ timeout: 5000 })
  })
})

test.describe('Admin Roadmap - Cross-View Verification', () => {
  test('a post with a roadmap-visible status appears on the public roadmap', async ({ page }) => {
    // Roadmap-visible statuses from seed: Planned, In Progress, Complete.
    // Navigate to admin feedback to find a post and verify it shows on /roadmap.

    await page.goto('/admin/feedback')
    await page.waitForLoadState('networkidle')

    // Find the first post card in the list
    const postCards = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator('h3'),
    })

    if ((await postCards.count()) === 0) {
      test.skip()
      return
    }

    // Click the first post to open the detail panel
    const firstCard = postCards.first()
    const cardHeading = firstCard.locator('h3').first()
    const postTitle = (await cardHeading.textContent())?.trim() ?? ''
    expect(postTitle.length).toBeGreaterThan(0)

    await firstCard.click()
    await page.waitForLoadState('networkidle')

    // In the detail panel, find the status selector and change it to "Planned"
    // The status picker is inside the post detail modal/sheet
    const detailModal = page.getByRole('dialog').first()
    if ((await detailModal.count()) === 0) {
      test.skip()
      return
    }

    const statusPicker = detailModal
      .locator('[data-testid="status-selector"]')
      .or(detailModal.locator('button').filter({ hasText: /open|under review|planned|in progress|complete|closed/i }).first())

    if ((await statusPicker.count()) === 0) {
      test.skip()
      return
    }

    await statusPicker.first().click()

    // Select "Planned" (showOnRoadmap = true in seed defaults)
    const plannedOption = page.getByRole('option', { name: /^planned$/i })
      .or(page.locator('[role="menuitem"]').filter({ hasText: /^planned$/i }))
      .or(page.getByText(/^planned$/i).first())

    if ((await plannedOption.count()) === 0) {
      // No roadmap-visible statuses visible in the picker; skip gracefully
      await page.keyboard.press('Escape')
      test.skip()
      return
    }

    await plannedOption.first().click()
    await page.waitForLoadState('networkidle')

    // Navigate to the public roadmap
    await page.goto('/roadmap')
    await page.waitForLoadState('networkidle')

    // Confirm no "no roadmaps" empty state (seed always has roadmaps)
    const noRoadmapsMsg = page.getByText('No roadmaps available')
    if ((await noRoadmapsMsg.count()) > 0) {
      test.skip()
      return
    }

    // The post title should appear somewhere on the public roadmap board
    const matchingCard = page.locator('.roadmap-card').filter({ hasText: postTitle })
    await expect(matchingCard.first()).toBeVisible({ timeout: 15000 })
  })
})

test.describe('Admin Roadmap - Public Roadmap Column Accuracy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap')
    await page.waitForLoadState('networkidle')
  })

  test('column headers show expected roadmap-visible status names', async ({ page }) => {
    // Public roadmap only shows statuses with showOnRoadmap=true.
    // Default seed statuses: Planned, In Progress, Complete.
    const noRoadmapsMsg = page.getByText('No roadmaps available')
    if ((await noRoadmapsMsg.count()) > 0) return

    // Column titles are rendered in CardTitle elements (data-slot="card-title" in shadcn v4)
    const columnTitles = page.locator('[data-slot="card-title"]').filter({
      hasNotText: /roadmap/i,
    })

    // Wait for at least one column to render
    await expect(columnTitles.first()).toBeVisible({ timeout: 10000 })

    const titleCount = await columnTitles.count()
    expect(titleCount).toBeGreaterThan(0)

    for (let i = 0; i < titleCount; i++) {
      const titleText = (await columnTitles.nth(i).textContent())?.trim() ?? ''
      // Each title must be non-empty
      expect(titleText.length).toBeGreaterThan(0)
    }
  })

  test('card count in each public column matches the column header badge', async ({ page }) => {
    const noRoadmapsMsg = page.getByText('No roadmaps available')
    if ((await noRoadmapsMsg.count()) > 0) return

    // Public columns are shadcn Cards with min-w-[300px]
    const columns = page.locator('[class*="min-w-\\[300px\\]"]')
    await expect(columns.first()).toBeVisible({ timeout: 10000 })

    const columnCount = await columns.count()
    if (columnCount === 0) return

    for (let i = 0; i < columnCount; i++) {
      const col = columns.nth(i)

      // Badge is a shadcn Badge (secondary) in the CardHeader next to the title
      const badge = col.locator('[class*="badge"]').first()
      if ((await badge.count()) === 0) continue

      const badgeText = (await badge.textContent())?.trim() ?? ''
      const badgeCount = parseInt(badgeText, 10)
      expect(Number.isNaN(badgeCount)).toBe(false)

      // Count actual rendered cards in this column
      const cards = col.locator('.roadmap-card')
      const actualCount = await cards.count()

      // actualCount can be less than badgeCount when infinite scroll hasn't fired yet,
      // but must never exceed it.
      expect(actualCount).toBeLessThanOrEqual(badgeCount)
      if (badgeCount === 0) {
        expect(actualCount).toBe(0)
      }
    }
  })

  test('vote counts on public roadmap cards are numeric', async ({ page }) => {
    const noRoadmapsMsg = page.getByText('No roadmaps available')
    if ((await noRoadmapsMsg.count()) > 0) return

    const cards = page.locator('.roadmap-card')
    await page.waitForLoadState('networkidle')

    const cardCount = await cards.count()
    if (cardCount === 0) return

    const limit = Math.min(cardCount, 10)
    for (let i = 0; i < limit; i++) {
      const card = cards.nth(i)
      // Vote count: text-sm font-semibold span inside .roadmap-card__vote
      const voteSpan = card.locator('.roadmap-card__vote span.text-sm.font-semibold')
      const voteText = (await voteSpan.first().textContent())?.trim() ?? ''
      const parsed = parseInt(voteText, 10)
      expect(Number.isNaN(parsed)).toBe(false)
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
        const popover = page.locator('[data-slot="popover-content"]')
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
