import { test, expect, type Page, type FrameLocator } from '@playwright/test'
import { seedWidgetIdentified, setWidgetSurfaces } from '../../utils/db-helpers'

function widgetFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe.quackback-widget-iframe')
}

/** Tab labels include an unread prefix (`1 unread Messages`) when badged. */
function tabButton(widget: FrameLocator, label: 'Messages' | 'Tickets') {
  return widget.getByRole('button', { name: new RegExp(`^(?:\\d+ unread )?${label}$`) })
}

async function openIdentified(page: Page, persona: 'customer' | 'teammate' | 'anon') {
  await page.goto(`/e2e/widget?persona=${persona}`)
  await expect(page.getByTestId('e2e-persona')).toHaveText(persona)
  await expect(page.locator('html')).toHaveAttribute('data-identified', '1', { timeout: 20000 })
  return widgetFrame(page)
}

test.describe('Identified widget harness', { tag: '@smoke' }, () => {
  test.beforeAll(() => {
    setWidgetSurfaces(true)
    seedWidgetIdentified()
  })

  test('customer identify shows Tickets and the seeded ticket', async ({ page }) => {
    const widget = await openIdentified(page, 'customer')
    await expect(page.locator('html')).toHaveAttribute('data-user-name', 'E2E Customer')
    await tabButton(widget, 'Tickets').click()
    await expect(widget.getByText('E2E Widget Ticket')).toBeVisible({ timeout: 15000 })
  })

  test('customer can rate a closed CSAT thread', async ({ page }) => {
    const widget = await openIdentified(page, 'customer')
    await tabButton(widget, 'Messages').click()
    await widget.getByText('How did we do?').click()
    await widget.getByRole('button', { name: '5 of 5' }).click()
    await expect(widget.getByText(/thanks/i).first()).toBeVisible({ timeout: 10000 })
  })

  test('customer can mark a help article helpful', async ({ page }) => {
    const widget = await openIdentified(page, 'customer')
    await page.evaluate(() => {
      const q = window.Quackback as ((cmd: string, arg?: unknown) => unknown) | undefined
      q?.('open', { articleId: 'e2e-widget-article' })
    })
    await expect(widget.getByText('E2E Widget Article')).toBeVisible({ timeout: 15000 })
    await widget.getByRole('button', { name: 'Yes, this helped' }).click()
    await expect(widget.getByText(/glad it helped/i)).toBeVisible({ timeout: 10000 })
  })

  test('customer can vote and submit an idea from Feedback', async ({ page }) => {
    const widget = await openIdentified(page, 'customer')
    await widget.getByRole('button', { name: 'Feedback', exact: true }).click()
    const vote = widget.getByRole('button', { name: /^Vote \(/ }).first()
    await expect(vote).toBeVisible({ timeout: 15000 })
    await vote.click()
    await expect(widget.getByRole('button', { name: /^Remove vote \(/ }).first()).toBeVisible({
      timeout: 10000,
    })

    const title = widget.getByRole('textbox', { name: 'Feedback title' })
    await expect(title).toBeVisible()
    const idea = `Widget e2e idea ${Date.now()}`
    await title.fill(idea)
    const boardPicker = widget.getByRole('combobox')
    if (await boardPicker.isVisible()) {
      await boardPicker.click()
      await widget.getByRole('option').first().click()
    }
    const submit = widget.getByRole('button', { name: 'Submit', exact: true })
    await expect(submit).toBeEnabled({ timeout: 10000 })
    await submit.click()
    await expect(widget.getByText(idea).first()).toBeVisible({ timeout: 15000 })
  })

  test('customer user menu loads engagement stats', async ({ page }) => {
    const widget = await openIdentified(page, 'customer')
    await widget.getByRole('button', { name: 'User menu' }).click()
    await expect(widget.getByText('Ideas', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(widget.getByText('Votes', { exact: true })).toBeVisible()
    await expect(widget.getByText('Comments', { exact: true })).toBeVisible()
  })

  test('teammate identify does not apply the host-app name', async ({ page }) => {
    const widget = await openIdentified(page, 'teammate')
    await expect(page.locator('html')).not.toHaveAttribute('data-user-name', 'Host App Teammate')
    await expect(widget.getByRole('button', { name: 'User menu' })).toBeVisible({ timeout: 10000 })
    await expect(tabButton(widget, 'Tickets')).toHaveCount(0)
  })
})
