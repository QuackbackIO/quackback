import { test, expect } from '@playwright/test'

test.describe('Portal feed filter panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('ticking Complete shows just the shipped ideas', async ({ page }) => {
    const status = page.getByRole('group', { name: 'Status', exact: true })
    // Nothing is ticked at the default scope, which the status chip names.
    await expect(status.getByRole('checkbox', { checked: true })).toHaveCount(0)
    await status.getByRole('checkbox', { name: /Complete/ }).click()

    await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })
    await expect(status.getByRole('checkbox', { name: /Complete/ })).toBeChecked()
    await expect(status.getByRole('checkbox', { name: /Open/ })).not.toBeChecked()
    const filters = page.getByRole('region', { name: 'Active filters' })
    await expect(filters.getByText('Status:')).toHaveCount(1)
    await expect(page.locator('[data-post-id]').first()).toContainText('Complete')
  })

  test('picking a board narrows the feed and shows counts', async ({ page }) => {
    const boards = page.getByRole('group', { name: 'Boards' })
    const board = boards.getByRole('button').nth(1)
    await expect(board).toHaveText(/\d+$/)
    await board.click()
    await expect(page).toHaveURL(/[?&]board=/, { timeout: 5000 })
    await expect(board).toHaveAttribute('aria-pressed', 'true')
  })

  test('counts follow the other filters', async ({ page }) => {
    const open = page
      .getByRole('group', { name: 'Status', exact: true })
      .getByRole('checkbox', { name: /Open/ })
    await expect(open).toHaveText(/\d$/)
    await page.getByRole('searchbox', { name: 'Search ideas' }).fill('xyzzy_no_such_idea')
    await expect(page).toHaveURL(/[?&]search=/, { timeout: 5000 })
    // A row with no posts shows no number.
    await expect(open).not.toHaveText(/\d$/, { timeout: 5000 })
  })

  test('a tag on a card filters the feed by that tag', async ({ page }) => {
    const tag = page.locator('[data-post-id] button:not([data-testid])').first()
    await tag.click()
    await expect(page).toHaveURL(/[?&]tagIds=/, { timeout: 5000 })
  })

  test('anonymous visitors get no Show section, even from a view link', async ({ page }) => {
    await page.goto('/?view=mine')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('group', { name: 'Boards' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Show' })).toHaveCount(0)
    await expect(
      page.getByRole('region', { name: 'Active filters' }).getByText('Show:')
    ).toHaveCount(0)
  })
})

test.describe('Portal feed filters on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the Filters sheet applies a board as it is picked', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('group', { name: 'Boards' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Filters' }).click()
    const boards = page.getByRole('dialog').getByRole('group', { name: 'Boards' })
    await boards.getByRole('button').nth(1).click()
    await expect(page).toHaveURL(/[?&]board=/, { timeout: 5000 })

    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('button', { name: /Filters, 1 on/ })).toBeVisible()
    // The board shows as a chip too, so the phone feed says what it holds.
    await expect(
      page.getByRole('region', { name: 'Active filters' }).getByText('Board:')
    ).toBeVisible()
  })
})
