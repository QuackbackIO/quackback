/**
 * Support inbox: opening the inbox, its views, filters, search and the live
 * list (journeys INB-01..INB-31, INB-92, INB-96).
 *
 * The admin inbox is shared by every test in the shard, so each test finds its
 * own rows by marker (`?q=<marker>` or a minted teammate's own views) and never
 * asserts on global counts, the first row or an empty list.
 */
import type { Page } from '@playwright/test'
import { supportDb } from '../../support/db'
import {
  test,
  expect,
  composer,
  conversationWithMessage,
  conversationState,
  conversationTypeId,
  detailsPanel,
  inboxUrl,
  listRows,
  openConversation,
  seedMentionNote,
  sendFromComposer,
  waitForConversation,
  widgetStartConversation,
} from '../../support/inbox'

test.use({ viewport: { width: 1920, height: 1080 } })

function nav(page: Page) {
  return page.getByRole('navigation').filter({ hasText: 'All conversations' })
}

function navRow(page: Page, label: string) {
  return nav(page).getByRole('button', { name: new RegExp(`^${label}( ?\\d+)?$`) })
}

/** Click a nav row until the click lands after hydration (the URL moves). */
async function selectNav(page: Page, label: string, url: RegExp) {
  await expect(async () => {
    await navRow(page, label).click()
    await expect(page).toHaveURL(url, { timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
  await expect(navRow(page, label)).toHaveAttribute('data-active', 'true')
}

/**
 * The list (searched by `marker`) shows exactly these conversations. The total
 * is checked first: it only settles once the new list replaced the old one, so
 * the per-row checks never pass on a list in transition.
 */
async function expectListed(page: Page, marker: string, shown: { visitorName: string }[]) {
  if (shown.length === 0) {
    await expect(page.getByText('No conversations match these filters')).toBeVisible({
      timeout: 15_000,
    })
  }
  await expect(listRows(page, marker)).toHaveCount(shown.length, { timeout: 15_000 })
  for (const c of shown) await expect(listRows(page, c.visitorName)).toHaveCount(1)
}

/** Pick a triage facet from the Status menu. */
async function pickFacet(page: Page, current: string, next: string) {
  await expect(async () => {
    await page.getByRole('button', { name: current, exact: true }).click()
    await page.getByRole('menuitem', { name: next, exact: true }).click({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
}

test.describe('inbox views', () => {
  test(
    'INB-01 the inbox opens on All conversations, open, most recent, with exact badges',
    {
      tag: '@smoke',
    },
    async ({ teammate, seed, marker }) => {
      const { page, mate } = await teammate()
      // Two open real threads assigned to the teammate count; a closed one and
      // a test thread (its visitor is the teammate's test customer) do not.
      await seed({ assignee: mate.principalId, messages: [`open one ${marker}`] })
      await seed({ assignee: mate.principalId, messages: [`open two ${marker}`] })
      await seed({ assignee: mate.principalId, status: 'closed', messages: [`closed ${marker}`] })
      await seed({
        assignee: mate.principalId,
        testOwner: mate.principalId,
        messages: [`test thread ${marker}`],
      })
      await seed({ messages: [`unassigned ${marker}`] })

      const unassignedNow = async () => {
        const [row] = await supportDb()<{ n: number }[]>`
        SELECT count(*)::int AS n FROM conversations c JOIN principal v ON v.id = c.visitor_principal_id
        WHERE c.status = 'open' AND c.assigned_agent_principal_id IS NULL
          AND v.test_owner_principal_id IS NULL`
        return row.n
      }

      await page.goto('/admin/inbox')
      await expect(page).not.toHaveURL(/view=/)
      await expect(navRow(page, 'All conversations')).toHaveAttribute('data-active', 'true')
      await expect(navRow(page, 'Assigned to me')).toHaveText(/^Assigned to me\s*2$/)
      await expect(page.getByRole('button', { name: 'open', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Sort: Most recent' })).toBeVisible()
      await expect(page.getByText('Select a conversation', { exact: true })).toBeVisible()
      await expect(
        page.getByText('Choose a conversation from the list to view and reply.')
      ).toBeVisible()

      // Unassigned counts every open, real, unassigned thread in the workspace;
      // other tests add and close them meanwhile, so compare with a database
      // count read around the same page load.
      await expect(async () => {
        const before = await unassignedNow()
        await page.reload()
        const text = (await navRow(page, 'Unassigned').textContent({ timeout: 10_000 })) ?? ''
        const after = await unassignedNow()
        const shown = Number(text.replace(/\D+/g, '') || '0')
        expect([before, after]).toContain(shown)
      }).toPass({ timeout: 20_000 })
    }
  )

  test(
    'INB-05 each nav entry moves the URL, the highlight and the listed rows',
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      const { page, mate } = await teammate()
      const mine = await seed({ assignee: mate.principalId, visitorName: `Mine ${marker}` })
      const free = await seed({ visitorName: `Free ${marker}` })
      const spam = await seed({
        status: 'closed',
        endReason: 'spam',
        spamReason: 'burst_rate',
        visitorName: `Spam ${marker}`,
      })
      await page.goto(inboxUrl({ q: marker }))
      await expectListed(page, marker, [mine, free])

      await selectNav(page, 'Assigned to me', /view=mine/)
      await expectListed(page, marker, [mine])

      await selectNav(page, 'Unassigned', /view=unassigned/)
      await expectListed(page, marker, [free])
      await expect(navRow(page, 'Assigned to me')).not.toHaveAttribute('data-active', 'true')

      await selectNav(page, 'Spam', /view=spam/)
      await expectListed(page, marker, [spam])
      // Spam has no triage refinements: the Status menu is hidden there.
      await expect(page.getByRole('button', { name: 'open', exact: true })).toHaveCount(0)

      // Consecutive steps always expect different rows, so a step can never pass
      // on the list it is leaving.
      await selectNav(page, 'Mentions', /view=mentions/)
      await expectListed(page, marker, [])
      await selectNav(page, 'All conversations', /view=all/)
      await expectListed(page, marker, [mine, free])
      await selectNav(page, 'Created by me', /view=created_by_me/)
      await expectListed(page, marker, [])
    }
  )

  test(
    'INB-07 Assigned to me counts and lists only my open real threads',
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      const { page: aPage, mate: a } = await teammate()
      const { page: bPage } = await teammate()
      const open1 = await seed({ assignee: a.principalId, messages: [`open one ${marker}`] })
      const open2 = await seed({ assignee: a.principalId, messages: [`open two ${marker}`] })
      const closed = await seed({
        assignee: a.principalId,
        status: 'closed',
        messages: [`closed ${marker}`],
      })
      const testThread = await seed({
        assignee: a.principalId,
        testOwner: a.principalId,
        messages: [`test thread ${marker}`],
      })

      await aPage.goto(inboxUrl({ view: 'mine' }))
      await expect(navRow(aPage, 'Assigned to me')).toHaveText(/^Assigned to me\s*2$/)
      await expect(listRows(aPage, open1.messages[0])).toHaveCount(1)
      await expect(listRows(aPage, open2.messages[0])).toHaveCount(1)
      await expect(listRows(aPage, closed.messages[0])).toHaveCount(0)
      // The list keeps the teammate's own test thread, marked Test (the badge
      // above does not count it); the closed one is out of the open facet.
      await expect(listRows(aPage, testThread.messages[0])).toContainText('Test')
      await expect(listRows(aPage, open1.messages[0])).not.toContainText('Test')
      await expect(listRows(aPage, marker)).toHaveCount(3)

      // Teammate B has nothing assigned: no badge, none of A's rows.
      await bPage.goto(inboxUrl({ view: 'mine', q: marker }))
      await expect(bPage.getByText('No conversations match these filters')).toBeVisible({
        timeout: 15_000,
      })
      await expect(navRow(bPage, 'Assigned to me')).toHaveText(/^Assigned to me$/)
      await expect(listRows(bPage, marker)).toHaveCount(0)
    }
  )

  test(
    'INB-08 Unassigned lists unassigned rows in scope; a scoped teammate sees no-team rows and its own team only',
    {
      tag: '@core',
    },
    async ({ teammate, seed, people, marker }) => {
      const { page: admin } = await teammate()
      const { page: scoped } = await teammate({
        role: 'e2e_scoped_agent',
        teams: [people.teams.billing],
      })
      const noTeam = await seed({ visitorName: `No team ${marker}` })
      const billing = await seed({ team: people.teams.billing, visitorName: `Billing ${marker}` })
      const support = await seed({ team: people.teams.support, visitorName: `Support ${marker}` })
      const taken = await seed({
        assignee: people.people.agentB.principalId,
        visitorName: `Taken ${marker}`,
      })
      const rows = (page: Page, c: { visitorName: string }) => listRows(page, c.visitorName)

      await admin.goto(inboxUrl({ view: 'unassigned', q: marker }))
      await expect(rows(admin, noTeam)).toHaveCount(1, { timeout: 15_000 })
      await expect(rows(admin, billing)).toHaveCount(1)
      await expect(rows(admin, support)).toHaveCount(1)
      await expect(rows(admin, taken)).toHaveCount(0)

      await scoped.goto(inboxUrl({ view: 'unassigned', q: marker }))
      await expect(rows(scoped, noTeam)).toHaveCount(1, { timeout: 15_000 })
      await expect(rows(scoped, billing)).toHaveCount(1)
      await expect(rows(scoped, support)).toHaveCount(0)
      await expect(rows(scoped, taken)).toHaveCount(0)
    }
  )

  test(
    'INB-09 Mentions lists only conversations where the caller was mentioned in a note',
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      const { page: aPage, mate: a } = await teammate()
      const { page: bPage, mate: b } = await teammate()
      const mentioned = await seed({ visitorName: `Mentions A ${marker}` })
      const other = await seed({ visitorName: `Mentions B ${marker}` })
      await seedMentionNote(mentioned.uuid, b.principalId, a.principalId, `look ${marker}`)
      await seedMentionNote(other.uuid, a.principalId, b.principalId, `look ${marker}`)

      await aPage.goto(inboxUrl({ view: 'mentions', q: marker }))
      await expect(navRow(aPage, 'Mentions')).toHaveAttribute('data-active', 'true')
      await expect(listRows(aPage, mentioned.visitorName)).toHaveCount(1, { timeout: 15_000 })
      await expect(listRows(aPage, other.visitorName)).toHaveCount(0)

      await bPage.goto(inboxUrl({ view: 'mentions', q: marker }))
      await expect(listRows(bPage, other.visitorName)).toHaveCount(1, { timeout: 15_000 })
      await expect(listRows(bPage, mentioned.visitorName)).toHaveCount(0)
    }
  )

  test(
    'INB-12 a spam-ended thread shows only in Spam, which offers restore and delete forever',
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const c = await seed()

      await openConversation(page, c.id, c.messages[0])
      await page.getByRole('button', { name: 'More conversation actions' }).click()
      await page.getByRole('menuitem', { name: 'End conversation' }).click()
      const dialog = page.getByRole('dialog', { name: 'End conversation' })
      await dialog.getByRole('radio', { name: 'Spam' }).click()
      await dialog.getByRole('button', { name: 'End conversation' }).click()
      await expect(page.getByText('Conversation ended', { exact: true }).first()).toBeVisible()
      await waitForConversation(c.uuid, 'the spam end', (r) => r.end_reason === 'spam')

      // Not in the closed facet of All conversations...
      await page.goto(inboxUrl({ q: marker, status: 'closed' }))
      await expect(page.getByText('No conversations match these filters')).toBeVisible({
        timeout: 15_000,
      })
      await expect(listRows(page, c.visitorName)).toHaveCount(0)
      // ...only in Spam. The thread reads Spam with a restore action, and
      // selecting the row offers only restore and delete forever.
      await page.goto(inboxUrl({ view: 'spam', q: marker, i: c.id }))
      await expect(listRows(page, c.visitorName)).toHaveCount(1, { timeout: 15_000 })
      const status = detailsPanel(page).getByRole('button', { name: 'Spam', exact: true })
      await expect(status).toBeVisible()
      await status.click()
      await expect(page.getByRole('menuitem', { name: 'Restore from spam' })).toBeVisible()
      await page.keyboard.press('Escape')
      const bar = page.getByRole('toolbar', { name: 'Bulk actions' })
      await expect(async () => {
        await page.keyboard.press('x')
        await expect(bar).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 10_000 })
      await expect(bar.getByRole('button', { name: 'Restore' })).toBeVisible()
      await expect(bar.getByRole('button', { name: 'Delete forever' })).toBeVisible()
      await expect(bar.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
    }
  )

  test(
    "INB-15 the team inbox lists only that team's conversations",
    {
      tag: '@core',
    },
    async ({ teammate, seed, people, marker }) => {
      const { page } = await teammate()
      const support = await seed({ team: people.teams.support, visitorName: `Support ${marker}` })
      const billing = await seed({ team: people.teams.billing, visitorName: `Billing ${marker}` })
      const none = await seed({ visitorName: `None ${marker}` })

      await page.goto(inboxUrl({ q: marker }))
      await expectListed(page, marker, [support, billing, none])
      await selectNav(page, 'E2E Support', new RegExp(`team=${people.teams.support}`))
      await expectListed(page, marker, [support])
      // Refinements still apply inside a team scope.
      await expect(page.getByRole('button', { name: 'open', exact: true })).toBeVisible()
      // A junk team id is dropped: back to All conversations.
      await page.goto(`/admin/inbox?team=team_nope&q=${marker}`)
      await expectListed(page, marker, [support, billing, none])
      await expect(navRow(page, 'All conversations')).toHaveAttribute('data-active', 'true')
    }
  )

  test(
    'INB-21 the Open, Waiting and Closed facets each list only that state',
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const open = await seed({ visitorName: `Open ${marker}` })
      const snoozed = await seed({
        status: 'snoozed',
        snoozedUntil: new Date(Date.now() + 3_600_000),
        visitorName: `Snoozed ${marker}`,
      })
      const closed = await seed({ status: 'closed', visitorName: `Closed ${marker}` })
      await page.goto(inboxUrl({ q: marker }))
      await expectListed(page, marker, [open])

      await pickFacet(page, 'open', 'waiting')
      await expect(page).toHaveURL(/status=waiting/)
      await expectListed(page, marker, [snoozed])

      await pickFacet(page, 'waiting', 'closed')
      await expect(page).toHaveURL(/status=closed/)
      await expectListed(page, marker, [closed])

      await pickFacet(page, 'closed', 'All')
      await expect(page).toHaveURL(/status=all/)
      await expectListed(page, marker, [open, snoozed, closed])
    }
  )

  test(
    'INB-23 search shows highlighted snippets for message matches, ordered by best match',
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const term = `zq${marker.replace(/[^a-z0-9]/g, '').slice(-10)}`
      const byMessage = await seed({
        visitorName: `Plain ${marker}`,
        messages: [`my order ${term} never arrived`, `any news?`],
      })
      const byName = await seed({ visitorName: `Named ${term}`, messages: [`hi ${marker}`] })

      await page.goto('/admin/inbox')
      const box = page.getByRole('textbox', { name: 'Search the inbox' })
      // Typed before hydration the input loses the value; type until the
      // debounced term reaches the URL.
      await expect(async () => {
        await box.fill('')
        await box.pressSequentially(term)
        await expect(page).toHaveURL(new RegExp(`q=${term}`), { timeout: 3_000 })
      }).toPass({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: 'Sort: Best match' })).toBeVisible()

      const messageRow = listRows(page, byMessage.visitorName)
      const nameRow = listRows(page, byName.visitorName)
      await expect(listRows(page, term)).toHaveCount(2, { timeout: 15_000 })
      await expect(messageRow).toHaveCount(1)
      await expect(nameRow).toHaveCount(1)
      // The message match shows the excerpt with the term highlighted, not the
      // newest message; the name-only match keeps its ordinary preview.
      await expect(messageRow.locator('mark')).toHaveText(term)
      await expect(messageRow).toContainText('never arrived')
      await expect(messageRow).not.toContainText('any news?')
      await expect(nameRow.locator('mark')).toHaveCount(0)
      await expect(nameRow).toContainText(`hi ${marker}`)

      // Clearing the search drops snippets and goes back to Most recent.
      await box.fill('')
      await expect(page.getByRole('button', { name: 'Sort: Most recent' })).toBeVisible()
      await expect(page.locator('div.group mark')).toHaveCount(0)
    }
  )

  test(
    'INB-27 opening a conversation shows the thread, details and composer and marks it read',
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      const { page } = await teammate()
      const c = await seed({ messages: [`first ${marker}`, `second ${marker}`] })
      expect((await conversationState(c.uuid)).agent_last_read_at).toBeNull()

      await page.goto(inboxUrl({ q: marker }))
      const row = listRows(page, c.visitorName)
      await expect(async () => {
        await row.click()
        await expect(page).toHaveURL(new RegExp(`i=${c.id}`), { timeout: 2_000 })
      }).toPass({ timeout: 15_000 })
      const thread = page.getByRole('main')
      await expect(thread.getByText(`first ${marker}`, { exact: true })).toBeVisible()
      await expect(detailsPanel(page)).toBeVisible()
      await expect(composer(page)).toBeVisible()
      await waitForConversation(c.uuid, 'the read watermark', (r) => r.agent_last_read_at !== null)
    }
  )

  test(
    'INB-30 opening a thread clears its unread badge; a new visitor message brings it back',
    {
      tag: '@core',
    },
    async ({ teammate, browser, marker }) => {
      test.setTimeout(60_000)
      const { page } = await teammate()
      const visitor = await (await browser.newContext()).newPage()
      await widgetStartConversation(visitor, `first ${marker}`)
      const uuid = await conversationWithMessage(`first ${marker}`)

      await page.goto(inboxUrl({ q: marker }))
      const row = listRows(page, marker)
      const badge = row.locator('span.rounded-full.bg-primary')
      await expect(row).toHaveCount(1, { timeout: 15_000 })
      await expect(badge).toHaveText('1')

      await expect(async () => {
        await row.click()
        await expect(page).toHaveURL(new RegExp(`i=${conversationTypeId(uuid)}`), {
          timeout: 2_000,
        })
      }).toPass({ timeout: 15_000 })
      await expect(badge).toHaveCount(0)
      await waitForConversation(uuid, 'the read watermark', (r) => r.agent_last_read_at !== null)

      // Leave the thread, then the visitor writes again: unread, live.
      await page.goto(inboxUrl({ q: marker }))
      await expect(row).toHaveCount(1, { timeout: 15_000 })
      await expect(badge).toHaveCount(0)
      const editor = visitor.locator('.ProseMirror[contenteditable="true"]')
      await editor.click()
      await editor.fill(`second ${marker}`)
      await visitor.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(badge).toHaveText('1', { timeout: 15_000 })
      await visitor.context().close()
    }
  )

  test(
    "INB-92 a second teammate's list and open pane follow a reply, an assignment and a close live",
    {
      tag: '@core',
    },
    async ({ teammate, seed, marker }) => {
      test.setTimeout(60_000)
      const { page: a, mate: aMate } = await teammate()
      const { page: b, mate: bMate } = await teammate()
      const c = await seed({ visitorName: `Live ${marker}` })
      const other = await seed({ visitorName: `Bystander ${marker}` })

      await openConversation(b, c.id, c.messages[0], { q: marker })
      await expect(listRows(b, other.visitorName)).toHaveCount(1)
      await openConversation(a, c.id, c.messages[0])

      const reply = `answer ${marker}`
      await sendFromComposer(a, reply, 'reply')
      await expect(b.getByText(reply, { exact: true })).toBeVisible({ timeout: 15_000 })

      await detailsPanel(a).getByRole('button', { name: aMate.name }).click()
      await a.getByRole('menuitem', { name: bMate.name }).click()
      await expect(
        detailsPanel(b).getByRole('button', { name: new RegExp(bMate.name) })
      ).toBeVisible({ timeout: 15_000 })

      await a.getByRole('button', { name: 'Close', exact: true }).click()
      await waitForConversation(c.uuid, 'the close', (r) => r.status === 'closed')
      // B's open list drops the closed row without a reload; the bystander stays.
      await expect(listRows(b, c.visitorName)).toHaveCount(0, { timeout: 15_000 })
      await expect(listRows(b, other.visitorName)).toHaveCount(1)
    }
  )
})
