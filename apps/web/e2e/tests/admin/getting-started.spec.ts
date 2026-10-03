import { expect, test } from '@playwright/test'

test.describe('onboarding launch plan', () => {
  test('the Launch plan page lists the plan with progress and a replay', async ({ page }) => {
    await page.goto('/admin/getting-started')
    await expect(page).toHaveURL(/\/admin\/getting-started$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Launch plan' })).toBeVisible()
    await expect(page.getByText(/^\d+ of \d+ done$/)).toBeVisible()
    await expect(page.getByRole('progressbar')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Replay the tour' })).toBeVisible()
  })

  test('Home shows the launch tiles while the plan is open', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const plan = page.getByRole('region', { name: 'Your launch plan' })
    if ((await plan.count()) === 0) {
      test.skip(true, 'The seeded workspace has already resolved its launch plan')
      return
    }
    await expect(plan.getByText('Portal is live')).toBeVisible()
    const tiles = await plan.getByRole('listitem').count()
    expect(tiles).toBeGreaterThanOrEqual(2)
    expect(tiles).toBeLessThanOrEqual(3)
    await expect(plan.getByRole('link', { name: 'See all' })).toHaveAttribute(
      'href',
      '/admin/getting-started'
    )
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
    const coachmark = page.getByRole('dialog')
    await expect(coachmark).toContainText('Your products.')
    for (let step = 1; step <= 5; step++) {
      await expect(coachmark).toContainText(`${step} of 5`)
      await expect(coachmark).toBeFocused()
      await page.keyboard.press('ArrowRight')
    }
    const end = page.getByRole('dialog', { name: "That's the tour" })
    await expect(end).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/?$/)
    await end.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.goto('/admin')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Take the 60-second tour' })).toHaveCount(0)
  })
})
