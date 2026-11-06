import { test, expect, type Page } from '@playwright/test'
import { waitForHydration } from '../../utils/helpers'

// The first open loads the dialog and its strings, which a cold dev server compiles.
const FIRST_OPEN = { timeout: 15_000 }

const searchRow = (page: Page) => page.getByRole('button', { name: 'Search', exact: true }).first()

test.describe('search', () => {
  test('searches and navigates', async ({ page }) => {
    await page.goto('/admin')
    const trigger = searchRow(page)
    await waitForHydration(trigger)
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog')
    const input = dialog.getByRole('combobox')
    await expect(input).toBeFocused(FIRST_OPEN)
    await input.fill('logo')
    const portal = dialog.getByRole('option', { name: 'Portal', exact: true })
    await expect(portal).toBeVisible()
    await expect(dialog.getByRole('option', { name: /Copilot/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await trigger.click()
    await expect(dialog.getByRole('combobox')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeFocused()
    await trigger.click()
    await dialog.getByRole('combobox').fill('logo')
    await dialog.getByRole('option', { name: 'Portal', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/settings\/portal/)
  })

  test('the palette opens from a product page and navigates with the keyboard', async ({
    page,
  }) => {
    await page.goto('/admin/feedback')
    await waitForHydration(searchRow(page))
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog')
    const input = dialog.getByRole('combobox')
    await expect(input).toBeFocused(FIRST_OPEN)
    await input.fill('tags')
    await expect(dialog.getByRole('option', { name: 'Tags', exact: true })).toBeVisible()
    await input.press('Enter')
    await expect(page).toHaveURL(/\/admin\/settings\/tags/)
    await expect(dialog).not.toBeVisible()
  })

  test('the tour ends on the sidebar Search row without leaving Home', async ({ page }) => {
    await page.goto('/admin')
    const help = page.getByRole('button', { name: 'Help', exact: true }).first()
    await waitForHydration(help)
    await expect(page.locator('[data-tour="search"]')).toHaveCount(1)
    await help.focus()
    await page.keyboard.press('ArrowDown')
    await page.getByRole('menuitem', { name: 'Replay the tour', exact: true }).focus()
    await page.keyboard.press('Enter')
    const coachmark = page.getByRole('dialog')
    await expect(coachmark).toBeFocused(FIRST_OPEN)
    for (let stop = 0; stop < 5; stop++) {
      if (await coachmark.getByText('Search.', { exact: true }).isVisible()) {
        await expect(page).toHaveURL(/\/admin\/?$/)
        await page.keyboard.press('Escape')
        await expect(coachmark).not.toBeVisible()
        return
      }
      await page.keyboard.press('ArrowRight')
      await expect(coachmark).toBeFocused()
    }
    throw new Error('The tour did not reach the Search row')
  })
})
