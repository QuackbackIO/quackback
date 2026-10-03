import { expect, test } from '@playwright/test'

test.describe('onboarding launch plan', () => {
  test('opens the full plan from See all', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.goto('/admin/getting-started')
    await expect(page).toHaveURL(/\/admin\/getting-started$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Your launch plan' })).toBeVisible()
    await expect(page.getByText('Connect Messenger', { exact: true })).toBeVisible()
    await expect(page.getByText('Write your first article', { exact: true })).toBeVisible()
  })

  test('shows three launch tiles and keeps an empty workspace quiet', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Your launch plan', exact: true })).toBeVisible()
    const plan = page.locator('section[aria-labelledby="getting-started-title"]')
    await expect(plan.locator('li')).toHaveCount(3)
    await expect(plan.getByText('Portal is live')).toBeVisible()
    await expect(plan.getByText('Connect Messenger')).toBeVisible()
    await expect(plan.getByText('Write your first article')).toBeVisible()
    await expect(page.getByText('Conversations waiting for reply')).toHaveCount(0)
    await expect(page.getByText('Nothing to review')).toHaveCount(0)
  })

  test('Home keeps the Actions menu and it opens a create dialog', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const actions = page.getByRole('button', { name: 'Actions' })
    await expect(actions).toBeVisible()
    await actions.click()
    await expect(page.getByRole('menuitem', { name: 'New post' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'New changelog' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'New changelog' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('runs the opt-in tour with the keyboard and can replay it from Help', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const help = page.getByRole('button', { name: 'Help', exact: true })
    await expect(help).toHaveAttribute('aria-haspopup', 'menu')
    await help.evaluate(async (element) => {
      await new Promise<void>((resolve) => {
        const ready = () => {
          if (Object.keys(element).some((key) => key.startsWith('__reactProps$'))) resolve()
          else requestAnimationFrame(ready)
        }
        ready()
      })
    })
    await help.focus()
    await page.keyboard.press('ArrowDown')
    await page.getByRole('menuitem', { name: 'Replay the tour', exact: true }).focus()
    await page.keyboard.press('Enter')
    for (let step = 1; step <= 5; step++) {
      await expect(page.getByRole('dialog')).toHaveAttribute('aria-label', `Step ${step} of 5`)
      await expect(page.getByRole('dialog')).toBeFocused()
      await page.keyboard.press('ArrowRight')
    }
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.goto('/admin')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Take the 60-second tour' })).toHaveCount(0)
  })
})
