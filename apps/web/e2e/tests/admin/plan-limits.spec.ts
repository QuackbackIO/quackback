/**
 * Plan limits, end to end: a workspace over its plan's limits, through the
 * 7 days to fix, the deadline, an upgrade, and an install without plan
 * billing.
 *
 * The billing projection and the clock are set from the database (see
 * e2e/scripts/plan-limits-state.ts): a projection is written the way the
 * projection write stores it, and "the deadline passes" moves the stored
 * deadline into the past. Detection, the banner, the page, the choosers and
 * every guard are the running app's own.
 *
 * Over the limits means one throwaway board and one throwaway teammate past
 * caps taken from the live counts, plus portal custom CSS (a Business
 * feature). Seed boards, posts and admins are never changed. The spec changes
 * workspace-wide state, so it runs serially and restores everything in
 * afterAll (and in beforeAll, after an interrupted run). While it runs, plan
 * billing is on for the whole workspace, so run it apart from other specs
 * when using more than one worker (CI uses one).
 *
 * It runs in the nightly e2e-full job. On its own:
 *   cd apps/web && ./node_modules/.bin/playwright test tests/admin/plan-limits.spec.ts
 */
import { test, expect, type Browser, type BrowserContext } from '@playwright/test'
import { flushMagicLinkRateLimit, loginViaMagicLink } from '../../utils/access-helpers'
import { waitForHydration } from '../../utils/helpers'
import {
  apiCreatePost,
  banner,
  deadlineText,
  openAdmin,
  planLimits,
  portalServesCss,
  type Baseline,
  type ThrowawayBoard,
} from '../../utils/plan-limits'

const TEAMMATE = 'e2e-plan-limits-teammate@example.test'
const LIMITS_PATH = '/admin/settings/billing/limits'
const READ_ONLY_NOTE = "This board isn't taking new feedback right now."
const PAUSED_HEADING = 'Your admin access is paused'

// Each test loads a dozen pages; a cold dev server compiles the first ones.
test.describe.configure({ mode: 'serial', timeout: 90_000 })

let caps: Baseline
let kept: ThrowawayBoard
let closed: ThrowawayBoard
let deadline: string
let postsBefore: number
let apiKey: string

/** A signed-out portal visitor. */
async function visitor(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ storageState: { cookies: [], origins: [] } })
}

/** The throwaway teammate, signed in with a dashboard session. */
async function teammate(browser: Browser): Promise<BrowserContext> {
  const context = await visitor(browser)
  flushMagicLinkRateLimit()
  await loginViaMagicLink(context, TEAMMATE)
  return context
}

test.beforeAll(async ({ browser }) => {
  // One sign-in first makes the teammate a user, so begin can take them off the team.
  const context = await teammate(browser)
  await context.close()
  const baseline = planLimits.begin(TEAMMATE)
  // Free allows one more board than the seed has and every current seat.
  caps = { boards: baseline.boards + 1, seats: baseline.seats }
  apiKey = planLimits.apiKey()
})

test.afterAll(() => {
  planLimits.end()
})

test('a lapsed trial over its limits: banner, page, chooser, fixes', async ({ page }) => {
  planLimits.lapse(caps)
  const spare = planLimits.board('E2E Plan limits spare')
  kept = planLimits.board('E2E Plan limits kept')
  planLimits.role(TEAMMATE, 'member')
  planLimits.css(true)

  // The first admin page load detects the drop and starts 7 days from now.
  await openAdmin(page)
  const grace = banner(page)
  await expect(grace).toHaveAttribute('data-plan-limits-banner', 'grace')
  const stored = planLimits.state().state
  expect(stored).not.toBeNull()
  expect(Date.parse(stored!.graceEndsAt) - Date.now()).toBeGreaterThan(6.9 * 86_400_000)
  deadline = deadlineText(stored!.graceEndsAt)
  await expect(grace).toContainText("Your workspace is over the Free plan's limits.")
  await expect(grace).toContainText(`Fix 2 issues by ${deadline}, or upgrade to keep everything.`)

  // Through the 7 days the custom CSS keeps working.
  expect(await portalServesCss(page.request)).toBe(true)

  await grace.getByRole('link', { name: 'Review issues' }).click()
  await expect(page).toHaveURL(new RegExp(`${LIMITS_PATH}$`))
  const deadlineCard = page.locator('[data-plan-limits-deadline="grace"]')
  await expect(deadlineCard.getByRole('heading', { level: 2 })).toContainText('Fix by')
  await expect(deadlineCard).toContainText('0 of 2 fixed')
  const boardsRow = page.locator('[data-plan-limit-row="maxBoards"]')
  await expect(boardsRow).toHaveAttribute('data-status', 'over')
  await expect(boardsRow).toContainText(`${caps.boards + 1} of ${caps.boards}`)
  const seatsRow = page.locator('[data-plan-limit-row="maxTeamSeats"]')
  await expect(seatsRow).toContainText(`${caps.seats + 1} of ${caps.seats}`)
  await expect(page.getByRole('heading', { name: `Pauses after ${deadline}` })).toBeVisible()
  await expect(page.locator('[data-plan-limit-feature="customCss"]')).toContainText('Custom CSS')
  await expect(page.locator('[data-plan-limits-keep="business"]')).toBeVisible()

  // By default the spare board (older, as empty) would stay open; keep the other one.
  const choose = boardsRow.getByRole('button', { name: 'Choose which board stays open' })
  await waitForHydration(choose)
  await choose.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: kept.name }).click()
  await dialog.getByRole('button', { name: `Keep ${kept.name} open` }).click()
  await expect(dialog).toBeHidden({ timeout: 10000 })
  expect(planLimits.state().state?.keptBoardId).toBe(kept.id)

  // Fix the boards in the app: delete the spare board.
  await page.goto(`/admin/settings/boards/${spare.slug}`)
  const remove = page.getByRole('button', { name: 'Delete board', exact: true })
  await waitForHydration(remove)
  await remove.click()
  const confirm = page.getByRole('alertdialog')
  await confirm.getByPlaceholder(spare.name).fill(spare.name)
  await confirm.getByRole('button', { name: 'Delete board', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/settings\/boards\/?(\?|$)/, { timeout: 10000 })

  await page.goto(LIMITS_PATH)
  await expect(page.locator('[data-plan-limit-row="maxBoards"]')).toHaveAttribute(
    'data-status',
    'fixed'
  )
  await expect(page.locator('[data-plan-limits-deadline="grace"]')).toContainText('1 of 2 fixed')

  // Fix the rest: the teammate leaves the team, the custom CSS goes, and the
  // AI assistant (on by default, so set up on most workspaces) stops replying.
  planLimits.role(TEAMMATE, 'user')
  planLimits.css(false)
  planLimits.assistantOff()
  await page.goto(LIMITS_PATH)
  await expect(page.getByText('Your workspace fits the Free plan.')).toBeVisible()
  await openAdmin(page)
  await expect(banner(page)).toHaveCount(0)
})

test('after the deadline: read-only board, paused teammate, paused feature', async ({
  page,
  browser,
}) => {
  // Over the same limits again: the 7 days already started are the ones that count.
  closed = planLimits.board('E2E Plan limits closed', true)
  planLimits.role(TEAMMATE, 'member')
  planLimits.css(true)
  await openAdmin(page)
  await expect(banner(page)).toHaveAttribute('data-plan-limits-banner', 'grace')
  await expect(banner(page)).toContainText(`by ${deadline},`)

  // Free's board cap drops to the busy boards and one more, so every quiet
  // board closes at the deadline, this spec's and any another spec left. New
  // limits start new 7 days, and the board chosen to stay open carries over.
  planLimits.lapse({ boards: planLimits.busyBoards() + 1, seats: caps.seats })
  await openAdmin(page)
  await expect(banner(page)).toHaveAttribute('data-plan-limits-banner', 'grace')
  expect(planLimits.state().state?.keptBoardId).toBe(kept.id)

  planLimits.overdue(TEAMMATE)
  postsBefore = planLimits.state().posts
  await openAdmin(page)
  await expect(banner(page)).toHaveAttribute('data-plan-limits-banner', 'enforced')
  await expect(banner(page)).toContainText("Your workspace is over the Free plan's limits.")

  // The board chosen to stay open takes feedback; the other is read-only.
  const refused = await apiCreatePost(page.request, apiKey, closed.id)
  expect(refused.status).toBe(403)
  expect(refused.body).toContain(READ_ONLY_NOTE)
  expect((await apiCreatePost(page.request, apiKey, kept.id)).status).toBe(201)

  const portal = await visitor(browser)
  const visit = await portal.newPage()
  await visit.goto(`/?board=${closed.slug}`)
  await expect(visit.getByText(READ_ONLY_NOTE)).toBeVisible({ timeout: 15000 })
  const vote = visit.getByTestId('vote-button').first()
  await expect(vote).toHaveAttribute('aria-disabled', 'true')
  await expect(vote).toHaveAccessibleName(/voting closed/)
  await visit.goto(`/?board=${kept.slug}`)
  await expect(visit.getByTestId('vote-button').first()).toBeVisible({ timeout: 15000 })
  await expect(visit.getByTestId('vote-button').first()).not.toHaveAttribute(
    'aria-disabled',
    'true'
  )
  await expect(visit.getByText(READ_ONLY_NOTE)).toHaveCount(0)
  await portal.close()

  // Paused features stop: the portal drops the custom CSS, settings say so.
  expect(await portalServesCss(page.request)).toBe(false)
  await page.goto('/admin/settings/portal?tab=design')
  await expect(page.getByText('Custom CSS is paused on the Free plan.')).toBeVisible({
    timeout: 15000,
  })

  // The teammate past the seats keeps the portal but loses the admin.
  const member = await teammate(browser)
  const memberPage = await member.newPage()
  await memberPage.goto('/admin')
  await expect(memberPage.getByRole('heading', { name: PAUSED_HEADING })).toBeVisible({
    timeout: 15000,
  })
  await member.close()
})

test('an upgrade brings everything back, posts intact', async ({ page, browser }) => {
  planLimits.upgrade()
  await openAdmin(page)
  await expect(banner(page)).toHaveCount(0)
  await page.goto(LIMITS_PATH)
  await expect(page.getByText('Your workspace fits the Business plan.')).toBeVisible()
  // The state is cleared, so a later drop starts 7 days of its own.
  expect(planLimits.state().state).toBeNull()

  const after = planLimits.state()
  // One post more than before the upgrade: the one the kept board took.
  expect(after.posts).toBe(postsBefore + 1)
  expect(after.boards[closed.slug]).toBe(1)

  const portal = await visitor(browser)
  const visit = await portal.newPage()
  await visit.goto(`/?board=${closed.slug}`)
  await expect(visit.getByText(`${closed.name} post`)).toBeVisible({ timeout: 15000 })
  await expect(visit.getByText(READ_ONLY_NOTE)).toHaveCount(0)
  await expect(visit.getByTestId('vote-button').first()).not.toHaveAttribute(
    'aria-disabled',
    'true'
  )
  await portal.close()
  expect((await apiCreatePost(page.request, apiKey, closed.id)).status).toBe(201)
  expect(await portalServesCss(page.request)).toBe(true)

  const member = await teammate(browser)
  const memberPage = await member.newPage()
  await memberPage.goto('/admin')
  await expect(memberPage.getByRole('navigation').first()).toBeVisible({ timeout: 15000 })
  await expect(memberPage.getByRole('heading', { name: PAUSED_HEADING })).toHaveCount(0)
  await member.close()
})

test('without plan billing, tier limits cap creation only', async ({ page, browser }) => {
  // The same data and an overdue state, with only plan billing turned off.
  planLimits.lapse(caps)
  await openAdmin(page)
  await expect(banner(page)).toHaveAttribute('data-plan-limits-banner', 'grace')
  const overdue = planLimits.overdue(TEAMMATE)
  planLimits.noPlanBilling(caps)

  // The tier cap is in force: a new board is refused.
  await expect(async () => {
    const response = await page.request.post('/api/v1/boards', {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: { name: `E2E Plan limits refused ${Date.now()}` },
    })
    expect(response.status()).toBeGreaterThanOrEqual(400)
  }).toPass({ timeout: 15000 })

  await openAdmin(page)
  await expect(page.getByRole('navigation').first()).toBeVisible()
  await expect(banner(page)).toHaveCount(0)

  const portal = await visitor(browser)
  const visit = await portal.newPage()
  await visit.goto(`/?board=${closed.slug}`)
  await expect(visit.getByText(`${closed.name} post`)).toBeVisible({ timeout: 15000 })
  await expect(visit.getByText(READ_ONLY_NOTE)).toHaveCount(0)
  await expect(visit.getByTestId('vote-button').first()).not.toHaveAttribute(
    'aria-disabled',
    'true'
  )
  await portal.close()
  expect((await apiCreatePost(page.request, apiKey, closed.id)).status).toBe(201)
  expect(await portalServesCss(page.request)).toBe(true)

  const member = await teammate(browser)
  const memberPage = await member.newPage()
  await memberPage.goto('/admin')
  await expect(memberPage.getByRole('navigation').first()).toBeVisible({ timeout: 15000 })
  await expect(memberPage.getByRole('heading', { name: PAUSED_HEADING })).toHaveCount(0)
  await member.close()

  // Every read above left the stored state as it was: no new grace, nothing cleared.
  expect(planLimits.state().state).toEqual(overdue)
})
