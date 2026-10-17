import { test, expect } from '@playwright/test'

// Runs signed in (the admin storage state), so the portal treats the viewer as
// a real user and offers the Show views.
test.describe('Portal feed views for a signed-in viewer', () => {
  test('My ideas, Voted and Following narrow the feed', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const show = page.getByRole('group', { name: 'Show' })
    await expect(show.getByRole('button', { name: /All ideas/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    for (const [label, view] of [
      ['My ideas', 'mine'],
      ['Voted', 'voted'],
      ['Following', 'following'],
    ] as const) {
      const button = show.getByRole('button', { name: new RegExp(`^${label}`) })
      const count = Number((await button.innerText()).match(/(\d+)\s*$/)?.[1] ?? 0)
      await button.click()
      await expect(page).toHaveURL(new RegExp(`[?&]view=${view}`), { timeout: 5000 })
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expect(
        page.getByRole('region', { name: 'Active filters' }).getByText(label, { exact: true })
      ).toBeVisible()
      // The count beside a view matches what the feed shows (first page).
      if (count > 0 && count <= 20) {
        await expect(page.locator('[data-post-id]')).toHaveCount(count, { timeout: 5000 })
      }
    }

    await show.getByRole('button', { name: /All ideas/ }).click()
    await expect(page).not.toHaveURL(/[?&]view=/)
  })
})
