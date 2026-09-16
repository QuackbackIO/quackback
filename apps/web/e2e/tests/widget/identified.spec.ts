import { test, expect, type Page, type FrameLocator } from '@playwright/test'
import { seedWidgetIdentified, setWidgetSurfaces } from '../../utils/db-helpers'

function widgetFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe.quackback-widget-iframe')
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
    await widget.getByRole('button', { name: 'Tickets', exact: true }).click()
    await expect(widget.getByText('E2E Widget Ticket')).toBeVisible({ timeout: 15000 })
  })

  test('customer can rate a closed CSAT thread', async ({ page }) => {
    const widget = await openIdentified(page, 'customer')
    await widget.getByRole('button', { name: 'Messages', exact: true }).click()
    await widget.getByText('E2E CSAT thread').click()
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

  test('customer user menu loads engagement stats', async ({ page }) => {
    const widget = await openIdentified(page, 'customer')
    await widget.getByRole('button', { name: 'User menu' }).click()
    await expect(widget.getByText('Ideas')).toBeVisible({ timeout: 10000 })
    await expect(widget.getByText('Votes')).toBeVisible()
    await expect(widget.getByText('Comments')).toBeVisible()
  })

  test('teammate identify does not apply the host-app name', async ({ page }) => {
    const widget = await openIdentified(page, 'teammate')
    await expect(page.locator('html')).not.toHaveAttribute('data-user-name', 'Host App Teammate')
    await expect(widget.getByRole('button', { name: 'User menu' })).toBeVisible({ timeout: 10000 })
    await expect(widget.getByRole('button', { name: 'Tickets', exact: true })).toHaveCount(0)
  })
})
