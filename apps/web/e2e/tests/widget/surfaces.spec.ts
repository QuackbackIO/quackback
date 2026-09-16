import { test, expect } from '@playwright/test'
import { setWidgetSurfaces } from '../../utils/db-helpers'

test.describe('Widget visitor surfaces', { tag: '@smoke' }, () => {
  test.beforeAll(() => {
    setWidgetSurfaces(true)
  })

  test('home lists posts, votes, and opens post detail', async ({ page }) => {
    await page.goto('/widget')
    const vote = page.getByRole('button', { name: /^Vote \(/ }).first()
    await expect(vote).toBeVisible({ timeout: 15000 })

    const countBefore = await vote.getAttribute('aria-label')
    await vote.click()
    await expect
      .poll(async () => vote.getAttribute('aria-pressed'), { timeout: 10000 })
      .toBe('true')
    expect(await vote.getAttribute('aria-label')).not.toBe(countBefore)

    const postRow = page
      .locator('button')
      .filter({ has: page.locator('p.font-medium') })
      .first()
    await expect(postRow).toBeVisible()
    await postRow.click()
    await expect(page.getByRole('button', { name: /^Vote \(/ }).first()).toBeVisible({
      timeout: 10000,
    })
    const comment = page.getByPlaceholder('Write a comment...')
    await expect(comment).toBeVisible({ timeout: 10000 })
    const body = `Widget e2e comment ${Date.now()}`
    await comment.click()
    await page.keyboard.type(body)
    await page.getByRole('button', { name: 'Post', exact: true }).click()
    await expect(page.getByText(body).first()).toBeVisible({ timeout: 15000 })
  })

  test('submit an idea from Home', async ({ page }) => {
    await page.goto('/widget')
    const title = page.getByRole('textbox', { name: 'Feedback title' })
    await expect(title).toBeVisible({ timeout: 15000 })
    const idea = `Widget e2e idea ${Date.now()}`
    await title.fill(idea)
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(page.getByText(idea).first()).toBeVisible({ timeout: 15000 })
  })

  test('Help tab loads via the widget BFF', async ({ page }) => {
    await page.goto('/widget')
    await page.getByRole('button', { name: 'Help', exact: true }).click()
    const search = page.getByRole('textbox', { name: 'Search help articles' })
    await expect(search).toBeVisible({ timeout: 10000 })
    const empty = page.getByText('No articles yet')
    const category = page.locator('button').filter({ hasNotText: 'Help' }).first()
    await expect(empty.or(category)).toBeVisible({ timeout: 10000 })
  })

  test('Changelog tab loads via the widget BFF', async ({ page }) => {
    await page.goto('/widget')
    await page.getByRole('button', { name: 'Changelog', exact: true }).click()
    const latest = page.getByRole('heading', { name: 'Latest' })
    const empty = page.getByText('No updates yet')
    await expect(latest.or(empty)).toBeVisible({ timeout: 10000 })
  })

  test('anonymous visitors do not see the Tickets tab', async ({ page }) => {
    await page.goto('/widget')
    await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeVisible({
      timeout: 10000,
    })
    await expect(page.getByRole('button', { name: 'Tickets', exact: true })).toHaveCount(0)
  })
})
