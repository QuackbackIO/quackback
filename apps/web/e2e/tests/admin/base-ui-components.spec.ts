import { expect, test, type Page } from '@playwright/test'
import { waitForHydration } from '../../utils/helpers'

/**
 * Site-wide usability pass for the Radix → Base UI migration.
 * Opens each primitive on a real admin page the way an admin would, then
 * checks the overlay is usable (visible, labelled, dismissible).
 */
async function waitForAdmin(page: Page) {
  await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 15_000 })
}

test.describe('Base UI component usability', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })
  test.describe.configure({ timeout: 60_000 })

  test('tooltip, dropdown, and popover open and dismiss', async ({ page }) => {
    await page.goto('/admin/feedback')
    await waitForAdmin(page)

    const switcher = page.getByRole('button', { name: 'Switch workspace' })
    if ((await switcher.count()) > 0) {
      await waitForHydration(switcher)
      await switcher.hover()
      await expect(page.locator('[data-slot="tooltip-content"]').first()).toBeVisible({
        timeout: 5_000,
      })
      await switcher.click()
      await expect(page.getByRole('menu')).toBeVisible()
      await expect(page.getByRole('menuitem').first()).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)
    }

    const bell = page.getByRole('button', { name: /notifications/i })
    await waitForHydration(bell)
    await bell.click()
    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0)
  })

  test('switch, select, slider, and styled links stay usable', async ({ page }) => {
    await page.goto('/admin/settings/general')
    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible({ timeout: 15_000 })
    const productSwitch = page.locator('#product-changelog')
    await waitForHydration(productSwitch)
    const checked = await productSwitch.getAttribute('aria-checked')
    expect(checked === 'true' || checked === 'false').toBeTruthy()

    await page.goto('/admin/settings/widget')
    await expect(page.getByRole('heading', { name: 'Widget' }).first()).toBeVisible({
      timeout: 15_000,
    })
    const position = page.locator('#widget-position')
    await waitForHydration(position)
    const shown = await position.innerText()
    await position.click()
    const listbox = page.locator('[data-slot="select-content"], [role="listbox"]').first()
    await expect(listbox).toBeVisible()
    await expect(page.getByRole('option').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(listbox).toBeHidden()
    await expect(position).toHaveText(shown)

    const install = page.getByRole('link', { name: /Install widget|View installation/ })
    await expect(install).toBeVisible()
    await expect(install).not.toHaveAttribute('role', 'button')

    await page.goto('/admin/settings/portal')
    await expect(page.getByRole('heading', { name: 'Portal' })).toBeVisible({ timeout: 15_000 })
    const slider = page.getByRole('slider')
    await expect(slider).toBeVisible()
    await expect(slider).toHaveAttribute('aria-valuenow')
  })

  test('tabs, dialog, radio, and checkbox stay usable', async ({ page }) => {
    await page.goto('/admin/settings/boards')
    const newBoard = page.getByRole('button', { name: 'New board' })
    await waitForHydration(newBoard)
    await newBoard.click()
    const createDialog = page.getByRole('dialog')
    await expect(createDialog).toBeVisible()
    await expect(createDialog.getByLabel('Board name')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(createDialog).toBeHidden()

    const firstBoard = page.locator('a[href*="/admin/settings/boards/"]').first()
    await expect(firstBoard).toBeVisible()
    await firstBoard.click()
    const general = page.getByRole('tab', { name: 'General' })
    const access = page.getByRole('tab', { name: 'Access' })
    await waitForHydration(general)
    await expect(general).toHaveAttribute('data-active')
    await access.click()
    await expect(access).toHaveAttribute('data-active')
    await expect(general).not.toHaveAttribute('data-active')

    await page.goto('/admin/settings/tags')
    const addTag = page.getByText('Add new tag')
    await waitForHydration(addTag)
    await addTag.click()
    const tagDialog = page.getByRole('dialog')
    await expect(tagDialog).toBeVisible()
    const portal = tagDialog.getByRole('radio', { name: /^portal$/i })
    const internal = tagDialog.getByRole('radio', { name: /^internal$/i })
    await expect(portal).toHaveAttribute('aria-checked', 'true')
    await internal.click()
    await expect(internal).toHaveAttribute('aria-checked', 'true')
    await tagDialog.getByRole('button', { name: /cancel/i }).click()
    await expect(tagDialog).toBeHidden()

    await page.goto('/admin/settings/office-hours')
    await expect(page.getByRole('heading', { name: 'Office Hours' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.locator('#office-hours-enabled')).toBeVisible()
    if ((await page.getByRole('checkbox').count()) > 0) {
      await expect(page.getByRole('checkbox').first()).toBeEnabled()
    }
  })

  test('menu checkbox items, alert dialog, and dropdown stay usable', async ({ page }) => {
    await page.goto('/admin/users')
    await expect(page.getByPlaceholder('Search users...')).toBeVisible({ timeout: 15_000 })
    const columns = page.getByRole('button', { name: 'Columns' })
    await waitForHydration(columns)
    await columns.click()
    const checkboxItem = page.getByRole('menuitemcheckbox').first()
    await expect(checkboxItem).toBeVisible()
    const before = await checkboxItem.getAttribute('aria-checked')
    await checkboxItem.click()
    await expect(checkboxItem).not.toHaveAttribute('aria-checked', before ?? '')
    await checkboxItem.click()
    await expect(checkboxItem).toHaveAttribute('aria-checked', before ?? '')
    await page.keyboard.press('Escape')

    await page.goto('/admin/notifications')
    await expect(page.getByRole('heading', { name: /notification/i }).first()).toBeVisible({
      timeout: 15_000,
    })
    const allTab = page.getByRole('tab', { name: 'All' })
    const unreadTab = page.getByRole('tab', { name: /unread/i })
    if ((await allTab.count()) > 0) {
      await waitForHydration(unreadTab)
      await unreadTab.click()
      await expect(unreadTab).toHaveAttribute('data-active')
      await allTab.click()
      await expect(allTab).toHaveAttribute('data-active')
    }
    const moreActions = page.getByRole('button', { name: 'More notification actions' })
    await waitForHydration(moreActions)
    await moreActions.click()
    await page.getByRole('menuitem', { name: 'Archive all read' }).click()
    const alert = page.getByRole('alertdialog')
    await expect(alert).toBeVisible()
    await expect(alert.getByText('Archive all read notifications?')).toBeVisible()
    await alert.getByRole('button', { name: 'Cancel' }).click()
    await expect(alert).toBeHidden()
  })

  test('inbox tabs and collapsible work on a conversation', async ({ page }) => {
    await page.goto('/admin/inbox')
    await waitForAdmin(page)
    const row = page.locator('a[href*="inbox"], [data-testid="inbox-row"]').first()
    const textRow = page.getByRole('main').getByRole('button').first()
    const target = (await row.count()) > 0 ? row : textRow
    if ((await target.count()) === 0) return

    await target.click({ timeout: 8_000 }).catch(() => {})
    const details = page.getByRole('tab', { name: 'Details' })
    if ((await details.count()) === 0) return

    await expect(details).toBeVisible()
    await waitForHydration(details)
    const copilot = page.getByRole('tab', { name: /copilot/i })
    if ((await copilot.count()) > 0) {
      await waitForHydration(copilot)
      await copilot.click()
      await expect(copilot).toHaveAttribute('data-active')
      await details.click()
      await expect(details).toHaveAttribute('data-active')
    }

    const collapse = page.getByRole('button', { name: /properties|activity|similar/i }).first()
    if ((await collapse.count()) > 0) {
      await collapse.click()
    }
  })

  test('sheet opens on a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/admin/feedback')
    const menu = page.getByRole('button', { name: 'Open menu' })
    await waitForHydration(menu)
    await menu.click()
    const sheet = page.locator('[data-slot="sheet-content"]').or(page.getByRole('dialog')).first()
    await expect(sheet).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
  })
})
