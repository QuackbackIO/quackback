import { test, expect } from '@playwright/test'
import { waitForHydration } from '../../utils/helpers'

test('Home typing finds settings without asking a model', async ({ page }) => {
  const modelRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/assistant/workspace')) modelRequests.push(request.url())
  })
  await page.goto('/admin')
  const input = page.getByRole('combobox').first()
  await waitForHydration(input)
  await input.fill('logo')
  const portal = page.getByRole('option', { name: 'Portal', exact: true })
  await expect(portal).toBeVisible()
  expect(modelRequests).toEqual([])
  await portal.click()
  await expect(page).toHaveURL(/\/admin\/settings\/portal/)
  expect(modelRequests).toEqual([])
})

test('the global palette opens from a product page and navigates with the keyboard', async ({
  page,
}) => {
  await page.goto('/admin/feedback')
  await waitForHydration(
    page.getByRole('button', { name: 'Search Quackback', exact: true }).first()
  )
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const input = dialog.getByRole('combobox')
  await expect(input).toBeFocused()
  await input.fill('office')
  await expect(dialog.getByRole('option', { name: 'Office hours', exact: true })).toBeVisible()
  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(page).toHaveURL(/\/admin\/settings\/office-hours/)
  await expect(dialog).not.toBeVisible()
})

test('Escape closes the palette', async ({ page }) => {
  await page.goto('/admin')
  const trigger = page.getByRole('button', { name: 'Search Quackback', exact: true }).first()
  await waitForHydration(trigger)
  await trigger.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(trigger).toBeFocused()
})

test('the keyboard tour ends at global search and remains replayable', async ({ page }) => {
  await page.goto('/admin')
  const help = page.getByRole('button', { name: 'Help', exact: true }).first()
  await waitForHydration(help)
  await help.focus()
  await help.press('Enter')
  const replay = page.getByRole('menuitem', { name: 'Replay the tour', exact: true })
  await expect(replay).toBeVisible()
  await replay.focus()
  await replay.press('Enter')
  const coachmark = page.getByRole('dialog', { name: /^Step \d+ of \d+$/ })
  for (let stop = 0; stop < 5; stop++) {
    await expect(coachmark).toBeVisible()
    await expect(coachmark).toBeFocused()
    if (await coachmark.getByText('Search from any page.', { exact: true }).isVisible()) {
      await page.keyboard.press('Escape')
      await expect(coachmark).not.toBeVisible()
      return
    }
    const previous = await coachmark.getAttribute('aria-label')
    await page.keyboard.press('ArrowRight')
    await expect(coachmark).not.toHaveAttribute('aria-label', previous!)
  }
  throw new Error('The tour did not reach global search')
})
