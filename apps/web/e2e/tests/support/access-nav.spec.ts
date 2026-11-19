/**
 * The admin shell follows each teammate's permissions: the rail lists only
 * pages they can open, a page they cannot open says so inside the shell (not a
 * 500), pages load for roles without member.view, Home counts only what the
 * teammate can see, and each support setting is gated by its own permission.
 *
 * Journeys: ACC-18, ACC-19, ACC-20, ACC-21, ACC-28.
 */
import { toUuid } from '@quackback/ids'
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { createRole, seedConv } from '../../support/access'
import { callServerFn, personApi } from '../../support/server-fns'
import { createTeam } from '../../support/teammates'
import { setFeatureFlag } from '../../utils/db-helpers'

const SUPPORT_ONLY = [
  'conversation.view',
  'ticket.view',
  'conversation.reply',
  'conversation.note',
  'conversation.set_status',
] as const

const rail = (page: Page) => page.getByRole('complementary').getByRole('navigation').first()

/** Collect every 5xx answer a page gets. */
function watch5xx(page: Page): string[] {
  const failures: string[] = []
  page.on('response', (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`)
  })
  return failures
}

async function expectNoAccessPage(page: Page, path: string): Promise<void> {
  const res = await page.goto(path)
  expect(res?.status(), path).toBeLessThan(500)
  await expect(page.getByRole('heading', { name: "You don't have access" }), path).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/admin')
}

test(
  "ACC-18 a Contributor's rail omits the pages the role cannot open, and Help center says no access",
  { tag: '@core' },
  async ({ asPerson }) => {
    // The Help center product must be on for its rail row to exist at all.
    setFeatureFlag('helpCenter', true)
    const admin = await asPerson('admin')
    await admin.goto('/admin')
    await expect(rail(admin).getByRole('link', { name: 'Help center' })).toBeVisible({
      timeout: 15_000,
    })

    const contributor = await asPerson('contributor')
    const failures = watch5xx(contributor)
    await contributor.goto('/admin')
    const nav = rail(contributor)
    await expect(nav.getByRole('link', { name: 'Support', exact: true })).toBeVisible({
      timeout: 15_000,
    })
    // Contributor holds post.view_private, changelog.view_draft, analytics.view,
    // status_page.publish and people.view, but not help_center.manage.
    for (const name of ['Feedback', 'Changelog', 'Users']) {
      await expect(nav.getByRole('link', { name, exact: true }), name).toBeVisible()
    }
    await expect(nav.getByRole('link', { name: 'Help center' })).toHaveCount(0)
    await expectNoAccessPage(contributor, '/admin/help-center')
    expect(failures).toEqual([])
  }
)

test(
  'ACC-19 a support-only role gets the in-shell "You don\'t have access" page with Back to Home, and a rail of Home, Roadmap and Support',
  { tag: '@core' },
  async ({ browser, marker, newTeammate }) => {
    const t = await newTeammate({ roleKey: await createRole(marker, SUPPORT_ONLY) })
    const page = await t.newPage(browser)
    const failures = watch5xx(page)
    await page.goto('/admin')
    const nav = rail(page)
    await expect(nav.getByRole('link', { name: 'Support', exact: true })).toBeVisible({
      timeout: 15_000,
    })
    await expect(nav.getByRole('link')).toHaveText(['Home', 'Roadmap', 'Support'])

    for (const path of [
      '/admin/feedback',
      '/admin/users',
      '/admin/help-center',
      '/admin/changelog',
      '/admin/analytics',
    ]) {
      await expectNoAccessPage(page, path)
    }
    // The way back goes Home.
    await page.getByRole('link', { name: 'Back to Home' }).click()
    await expect(page).toHaveURL(/\/admin\/?$/)
    expect(failures).toEqual([])
  }
)

test(
  'ACC-20 a custom role without member.view, company.view or people.view loads with no plan notice, no team rows and empty people pickers',
  { tag: '@core' },
  async ({ browser, marker, newTeammate }) => {
    const conv = await seedConv({ marker, label: 'unassigned' })
    const t = await newTeammate({
      roleKey: await createRole(marker, [
        'conversation.view',
        'conversation.reply',
        'conversation.assign',
        'ticket.view',
      ]),
    })
    const page = await t.newPage(browser)
    const failures = watch5xx(page)

    await page.goto(`/admin/inbox?view=all&q=${encodeURIComponent(marker)}&i=${conv.id}`)
    await expect(page.getByText(conv.messages[0]).first()).toBeVisible({ timeout: 15_000 })
    const inboxNav = page.getByRole('main').getByRole('navigation').first()
    await expect(inboxNav.getByRole('heading', { name: 'Support' })).toBeVisible()
    // No Teams section (listTeamsFn needs member.view), no Users page.
    await expect(inboxNav.getByText('Teams', { exact: true })).toHaveCount(0)
    await expect(rail(page).getByRole('link', { name: 'Users' })).toHaveCount(0)
    // No seat or plan notice.
    await expect(page.getByText(/seats? (left|used)|over your plan/i)).toHaveCount(0)

    // The assignee picker lists nobody but "me".
    await page.getByRole('button', { name: 'Unassigned', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Assign to me' })).toBeVisible()
    await expect(
      page.getByRole('menuitem', { name: /Ada Admin|Ben Agent|Sam Scoped|Cora Contributor/ })
    ).toHaveCount(0)
    await page.keyboard.press('Escape')

    // No company filter without company.view.
    await page.getByRole('button', { name: 'Filter' }).click()
    await expect(page.getByRole('menuitem', { name: /Company/ })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await expectNoAccessPage(page, '/admin/users')
    expect(failures).toEqual([])
  }
)

test(
  'ACC-21 Home loads for a team-scoped teammate and a Contributor and lists only conversations they can see',
  { tag: '@core' },
  async ({ browser, asPerson, playwright, people, marker, newTeammate }) => {
    const teamA = await createTeam(`${marker}-a`)
    const t = await newTeammate({ roleKey: 'e2e_scoped_agent', teams: [teamA.id] })
    const own = await seedConv({ marker, label: 'team A waiting', teamId: teamA.id })
    const billing = await seedConv({
      marker,
      label: 'billing waiting',
      teamId: people.teams.billing,
    })
    const other = await seedConv({ marker, label: 'support waiting', teamId: people.teams.support })
    // Waiting for a month: these lead the waiting list for anyone who can see them.
    for (const conv of [own, billing, other]) {
      await supportDb()`UPDATE conversations SET waiting_since = NOW() - interval '30 days', priority = 'urgent'
                      WHERE id = ${toUuid(conv.id as `conversation_${string}`)}`
    }

    const overviewOf = async (api: Awaited<ReturnType<typeof personApi>>) => {
      const res = await callServerFn(api, 'fetchAdminOverviewFn', undefined, { method: 'GET' })
      expect(res.ok, res.error.slice(0, 300)).toBe(true)
      return res.raw
    }
    const admin = await personApi(playwright, 'admin')
    const adminView = await overviewOf(admin)
    for (const conv of [own, billing, other])
      expect(adminView, `admin sees ${conv.subject}`).toContain(conv.id)

    const tApi = await t.api(playwright)
    const tView = await overviewOf(tApi)
    expect(tView).toContain(own.id)
    expect(tView).not.toContain(billing.id)
    expect(tView).not.toContain(other.id)

    const cApi = await personApi(playwright, 'contributor')
    const cView = await overviewOf(cApi)
    expect(cView).toContain(billing.id)
    expect(cView).not.toContain(own.id)
    expect(cView).not.toContain(other.id)

    // And the pages themselves load.
    for (const page of [await t.newPage(browser), await asPerson('contributor')]) {
      const failures = watch5xx(page)
      const res = await page.goto('/admin')
      expect(res?.status()).toBeLessThan(500)
      await expect(rail(page).getByRole('link', { name: 'Home' })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('main')).toBeVisible()
      expect(failures).toEqual([])
    }
    for (const api of [admin, tApi, cApi]) await api.dispose()
  }
)

test(
  'ACC-28 each support setting is refused without its permission and allowed with it',
  { tag: '@nightly' },
  async ({ playwright, marker, newTeammate }) => {
    test.setTimeout(60_000)
    const conv = await seedConv({ marker, label: 'unassigned' })
    // A role that holds conversation.view only: refused everywhere below.
    const bare = await newTeammate({ roleKey: await createRole(marker, ['conversation.view']) })
    const bareApi = await bare.api(playwright)
    const admin = await personApi(playwright, 'admin')
    const lead = await personApi(playwright, 'agentB')

    const hours = await callServerFn(admin, 'fetchOfficeHoursFn', undefined, { method: 'GET' })
    expect(hours.ok, hours.error).toBe(true)
    const autoAck = await callServerFn(admin, 'fetchEmailAutoAckFn', undefined, { method: 'GET' })
    expect(autoAck.ok, autoAck.error).toBe(true)

    const gates: Array<{
      fn: string
      data?: unknown
      method?: 'GET' | 'POST'
      permission: string
      allowed: typeof admin
    }> = [
      {
        fn: 'createTeamFn',
        data: { name: `${marker} gated team` },
        permission: 'team.manage',
        allowed: admin,
      },
      { fn: 'listTeamsFn', method: 'GET', permission: 'member.view', allowed: lead },
      {
        fn: 'fetchConversationRoutingFn',
        method: 'GET',
        permission: 'settings.manage',
        allowed: admin,
      },
      { fn: 'fetchOfficeHoursFn', method: 'GET', permission: 'office_hours.manage', allowed: lead },
      {
        fn: 'updateOfficeHoursFn',
        data: hours.data,
        permission: 'office_hours.manage',
        allowed: lead,
      },
      {
        fn: 'fetchEmailAutoAckFn',
        method: 'GET',
        permission: 'channel_account.manage',
        allowed: lead,
      },
      {
        fn: 'updateEmailAutoAckFn',
        data: autoAck.data,
        permission: 'channel_account.manage',
        allowed: lead,
      },
      {
        fn: 'assignConversationFn',
        data: { conversationId: conv.id, assignTo: null },
        permission: 'conversation.assign',
        allowed: lead,
      },
      {
        fn: 'bulkUpdateConversationsFn',
        data: { conversationIds: [conv.id], action: { type: 'delete_forever' } },
        permission: 'conversation.manage',
        allowed: admin,
      },
    ]
    for (const gate of gates) {
      const refused = await callServerFn(bareApi, gate.fn, gate.data, { method: gate.method })
      expect(refused.ok, `${gate.fn} without ${gate.permission}`).toBe(false)
      expect(refused.error, gate.fn).toContain(gate.permission)
      const allowed = await callServerFn(gate.allowed, gate.fn, gate.data, { method: gate.method })
      expect(allowed.ok, `${gate.fn} with ${gate.permission}: ${allowed.error.slice(0, 200)}`).toBe(
        true
      )
    }

    // The Away toggle needs only conversation.view; without it, refused.
    const away = await callServerFn(bareApi, 'setAgentAvailabilityFn', { availability: 'online' })
    expect(away.ok, away.error).toBe(true)
    const none = await newTeammate({ roleKey: 'e2e_no_support' })
    const noneApi = await none.api(playwright)
    const refusedAway = await callServerFn(noneApi, 'setAgentAvailabilityFn', {
      availability: 'away',
    })
    expect(refusedAway.ok).toBe(false)
    const [row] =
      await supportDb()`SELECT chat_availability FROM principal WHERE id = ${toUuid(none.principalId as `principal_${string}`)}`
    expect(row.chat_availability).toBe('online')
    for (const api of [bareApi, admin, lead, noneApi]) await api.dispose()
  }
)
