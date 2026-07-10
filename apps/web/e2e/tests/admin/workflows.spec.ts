import { test, expect, type Page } from '@playwright/test'
import { setSupportSurfaces } from '../../utils/db-helpers'

/**
 * Smoke coverage for the rebuilt workflows admin surface (support platform
 * §4.6): the grouped list at /admin/automation/workflows, the "New workflow"
 * template gallery, and the fullscreen builder at
 * /admin/automation/workflows/$workflowId.
 *
 * The "Route conversations to the right team" template ships with two
 * needs-setup team placeholders (see workflow-templates.ts), so creating it
 * is also the fixture for exercising the issues chip, the "Needs setup" list
 * badge, and an unresolved action step in the inspector.
 */

const TEMPLATE_NAME = 'Route conversations to the right team'
const FRONT_DOOR_TEMPLATE_NAME = 'Front-door triage bot'

/** The list row is a `div[role=button]` inside the `.divide-y` group list —
 *  not a semantic <tr>/<li>, so scope by structure + text rather than role,
 *  which would also match the row's own accessible name via its nested
 *  "Actions for …" button. */
function workflowRow(page: Page, name: string) {
  return page.locator('.divide-y > div').filter({ hasText: name }).first()
}

/** Deletes every list row with this exact name via the row's own dropdown +
 *  confirm dialog. Used both as in-test cleanup and as the final assertion
 *  that deletion works end to end. Loops (rather than asserting a single
 *  row) so it also mops up any workflow left behind by a prior failed run. */
async function deleteWorkflowsNamed(page: Page, name: string) {
  await page.goto('/admin/automation/workflows')
  for (let i = 0; i < 5; i++) {
    const row = workflowRow(page, name)
    if (!(await row.isVisible().catch(() => false))) return
    await row.getByRole('button', { name: `Actions for ${name}` }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete workflow' }).click()
    await expect(row).toBeHidden({ timeout: 10000 })
  }
}

test.describe('Admin Workflows', { tag: '@smoke' }, () => {
  test.beforeAll(() => {
    setSupportSurfaces(true)
  })

  test.afterEach(async ({ page }) => {
    // Best-effort cleanup even when an earlier assertion throws — the test
    // body also cleans up on the happy path, but this is the fallback.
    await deleteWorkflowsNamed(page, TEMPLATE_NAME).catch(() => {})
    await deleteWorkflowsNamed(page, FRONT_DOOR_TEMPLATE_NAME).catch(() => {})
  })

  test('list page renders with a New workflow control', async ({ page }) => {
    await page.goto('/admin/automation/workflows')

    await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible({
      timeout: 15000,
    })
    await expect(page.getByRole('button', { name: 'New workflow' })).toBeVisible()
  })

  test('create from template shows issues, an unresolved step, and needs-setup on the list', async ({
    page,
  }) => {
    await page.goto('/admin/automation/workflows')

    // The list is server-rendered before React hydrates, so the very first
    // click on the split "New workflow" button can land on inert HTML.
    const galleryDialog = page.getByRole('dialog', { name: 'Create a new workflow' })
    await expect(async () => {
      await page.getByRole('button', { name: 'New workflow' }).click()
      await page.getByRole('menuitem', { name: 'Create from template' }).click({ timeout: 2000 })
      await expect(galleryDialog).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 15000 })

    // Category rail + template cards.
    await expect(galleryDialog.getByRole('button', { name: 'Popular' })).toBeVisible()
    await expect(galleryDialog.getByRole('button', { name: 'Routing' })).toBeVisible()
    await expect(galleryDialog.getByRole('button', { name: 'SLA & priority' })).toBeVisible()
    await expect(galleryDialog.getByRole('button', { name: 'Housekeeping' })).toBeVisible()
    const templateCard = galleryDialog.getByRole('button', { name: new RegExp(TEMPLATE_NAME) })
    await expect(templateCard).toBeVisible()

    // Picking the template creates the workflow and navigates to its builder.
    await templateCard.click()
    await expect(page).toHaveURL(/\/admin\/automation\/workflows\/[^/]+$/, { timeout: 15000 })

    // Top bar: name + a Save control (disabled — nothing edited yet).
    await expect(page.getByRole('textbox', { name: 'Workflow name' })).toHaveValue(TEMPLATE_NAME, {
      timeout: 15000,
    })
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()

    // The template's two "Assign to team" steps both need setup, so the
    // issues chip reports 2.
    await expect(page.getByRole('button', { name: '2 issues' })).toBeVisible({ timeout: 10000 })

    // Canvas: the trigger card renders the trigger label.
    await expect(
      page.locator('[data-step-id]').filter({ hasText: 'New conversation' })
    ).toBeVisible()

    // Outline rail: trigger + branch + both unresolved action steps.
    const outline = page.getByRole('navigation', { name: 'Workflow outline' })
    await expect(outline.getByText('New conversation')).toBeVisible()
    await expect(outline.getByText('Branch · 2 paths')).toBeVisible()
    const outlineAssignRows = outline.getByRole('button', { name: /Assign to a team/ })
    await expect(outlineAssignRows.first()).toBeVisible()
    await expect(outlineAssignRows).toHaveCount(2)

    // Selecting an unconfigured "Assign to team" step shows the inspector's
    // team select with nothing chosen (placeholder text, not a real team).
    await outlineAssignRows.first().click()
    const inspector = page.getByRole('complementary')
    // The inspector header title and the action-type select's current value
    // both render "Assign to team" text; scope to the sticky header row.
    await expect(
      inspector.locator('.sticky').getByText('Assign to team', { exact: true })
    ).toBeVisible()
    await expect(inspector.getByText('Choose team')).toBeVisible()

    // Back to the list: the created workflow shows "Needs setup" and Draft.
    await page.getByRole('link', { name: 'Back to workflows' }).click()
    await expect(page).toHaveURL(/\/admin\/automation\/workflows$/, { timeout: 15000 })
    const row = workflowRow(page, TEMPLATE_NAME)
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row.getByText('Needs setup')).toBeVisible()
    await expect(row.getByText('Draft')).toBeVisible()

    // Cleanup: delete through the row's own dropdown + confirm dialog.
    await deleteWorkflowsNamed(page, TEMPLATE_NAME)
    await expect(workflowRow(page, TEMPLATE_NAME)).toBeHidden()
  })

  test('front-door triage bot hero template opens with reply-button paths and needs setup', async ({
    page,
  }) => {
    await page.goto('/admin/automation/workflows')

    // Same hydration guard as the sibling test above.
    const galleryDialog = page.getByRole('dialog', { name: 'Create a new workflow' })
    await expect(async () => {
      await page.getByRole('button', { name: 'New workflow' }).click()
      await page.getByRole('menuitem', { name: 'Create from template' }).click({ timeout: 2000 })
      await expect(galleryDialog).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 15000 })

    // The hero template lives in the new "Customer facing" category (Phase C,
    // slice C-5) rather than "Popular", so switch the category rail first.
    await galleryDialog.getByRole('button', { name: 'Customer facing' }).click()
    const templateCard = galleryDialog.getByRole('button', {
      name: new RegExp(FRONT_DOOR_TEMPLATE_NAME),
    })
    await expect(templateCard).toBeVisible()
    await templateCard.click()
    await expect(page).toHaveURL(/\/admin\/automation\/workflows\/[^/]+$/, { timeout: 15000 })

    await expect(page.getByRole('textbox', { name: 'Workflow name' })).toHaveValue(
      FRONT_DOOR_TEMPLATE_NAME,
      { timeout: 15000 }
    )

    // Canvas: the trigger card renders the trigger label.
    await expect(
      page.locator('[data-step-id]').filter({ hasText: 'New conversation' })
    ).toBeVisible()

    // Outline rail: the reply-buttons step fans out one path per button, and
    // the path header uses the button's own label (not its internal key).
    const outline = page.getByRole('navigation', { name: 'Workflow outline' })
    await expect(outline.getByText('New conversation')).toBeVisible()
    await expect(outline.getByText('Path A · Product question')).toBeVisible()
    await expect(outline.getByText('Path B · Report a bug')).toBeVisible()
    await expect(outline.getByText('Path C · Billing')).toBeVisible()
    await expect(outline.getByText('Path D · Talk to sales')).toBeVisible()

    // Every workspace ref (team/SLA policy/tag/attribute) in the template
    // ships as an unresolved needs-setup sentinel: 3 "assign to team" from
    // the Quinn hand-off branch, 1 collect-data attribute + 2 assign/SLA from
    // the bug path, 2 assign/SLA from the billing path, and 3 assign/tag/
    // collect-data from the sales path — 11 in total (see
    // workflow-templates.ts's front-door-triage-bot payload).
    await expect(page.getByRole('button', { name: '11 issues' })).toBeVisible({
      timeout: 10000,
    })

    // The Visual/JSON toggle still works: JSON mode shows the raw graph...
    await page.getByRole('button', { name: 'JSON' }).click()
    const jsonTextbox = page.getByRole('textbox', { name: 'Workflow graph JSON' })
    await expect(jsonTextbox).toBeVisible()
    await expect(jsonTextbox).toHaveValue(/welcome_message/)
    // ...and switching back to Visual restores the canvas.
    await page.getByRole('button', { name: 'Visual' }).click()
    await expect(
      page.locator('[data-step-id]').filter({ hasText: 'New conversation' })
    ).toBeVisible()

    // Cleanup: delete through the row's own dropdown + confirm dialog.
    await page.getByRole('link', { name: 'Back to workflows' }).click()
    await expect(page).toHaveURL(/\/admin\/automation\/workflows$/, { timeout: 15000 })
    await deleteWorkflowsNamed(page, FRONT_DOOR_TEMPLATE_NAME)
    await expect(workflowRow(page, FRONT_DOOR_TEMPLATE_NAME)).toBeHidden()
  })
})
