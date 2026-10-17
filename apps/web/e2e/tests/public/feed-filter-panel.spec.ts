import { test, expect } from '@playwright/test'

test.describe('Portal feed filter panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('checking Complete adds shipped ideas to the feed', async ({ page }) => {
    const status = page.getByRole('group', { name: 'Status' })
    await expect(status.getByRole('checkbox', { name: /Open/ })).toBeChecked()
    await status.getByRole('checkbox', { name: /Complete/ }).click()

    await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })
    await expect(status.getByRole('checkbox', { name: /Complete/ })).toBeChecked()
    await expect(
      page.locator('[data-post-id]').getByText('Complete', { exact: true }).first()
    ).toBeVisible()
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
    const open = page.getByRole('group', { name: 'Status' }).getByRole('checkbox', { name: /Open/ })
    await expect(open).not.toHaveText(/(?<!\d)0$/)
    await page.getByRole('searchbox', { name: 'Search ideas' }).fill('xyzzy_no_such_idea')
    await expect(page).toHaveURL(/[?&]search=/, { timeout: 5000 })
    await expect(open).toHaveText(/(?<!\d)0$/, { timeout: 5000 })
  })

  test('a tag on a card filters the feed by that tag', async ({ page }) => {
    const tag = page.locator('[data-post-id] button:not([data-testid])').first()
    await tag.click()
    await expect(page).toHaveURL(/[?&]tagIds=/, { timeout: 5000 })
  })

  test('anonymous visitors get no Show section', async ({ page }) => {
    await expect(page.getByRole('group', { name: 'Boards' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Show' })).toHaveCount(0)
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
  })
})
