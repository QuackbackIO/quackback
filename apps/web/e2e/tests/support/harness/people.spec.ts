/**
 * Self-test: every person's minted session signs them in as themselves, and
 * the roles and teams the seed gave them decide what they see.
 */
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../../support/fixtures'
import { supportDb } from '../../../support/db'
import { personStatePath, SUPPORT_PEOPLE, type SupportPersonName } from '../../../support/people'
import { seedConversation } from '../../../utils/db-helpers'

test.describe('people fixtures', { tag: '@smoke' }, () => {
  test('each stored session is that person', async ({ playwright, baseURL }) => {
    for (const name of Object.keys(SUPPORT_PEOPLE) as SupportPersonName[]) {
      const api = await playwright.request.newContext({
        baseURL,
        storageState: personStatePath(name),
      })
      const res = await api.get('/api/auth/get-session')
      expect(res.status(), name).toBe(200)
      const body = (await res.json()) as { user?: { email?: string } } | null
      expect(body?.user?.email, name).toBe(SUPPORT_PEOPLE[name].email)
      await api.dispose()
    }
  })

  test('team scope: a Support-team conversation is hidden from Billing teammates until it moves', async ({
    asPerson,
    people,
    marker,
  }) => {
    test.setTimeout(60_000)
    const seeded = seedConversation(marker)
    const id = toUuid(seeded.conversationId as `conversation_${string}`)
    const sql = supportDb()
    const setTeam = (team: string) =>
      sql`UPDATE conversations SET assigned_team_id = ${toUuid(team as `team_${string}`)}
          WHERE id = ${id}`
    await setTeam(people.teams.support)
    const threadUrl = `/admin/inbox?i=${seeded.conversationId}`
    const firstMessage = seeded.messages[0]

    const admin = await asPerson('admin')
    await admin.goto(threadUrl)
    await expect(admin.getByText(firstMessage).first()).toBeVisible({ timeout: 15_000 })

    for (const name of ['scoped', 'contributor'] as const) {
      const page = await asPerson(name)
      await page.goto(threadUrl)
      await expect(page.getByText('Conversation not found'), name).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(firstMessage)).toHaveCount(0)
    }

    await setTeam(people.teams.billing)
    const scoped = await asPerson('scoped')
    await scoped.goto(threadUrl)
    await expect(scoped.getByText(firstMessage).first()).toBeVisible({ timeout: 15_000 })
  })

  test('an unassigned conversation is open to every inbox role; the no-access teammate never sees its messages', async ({
    asPerson,
    marker,
  }) => {
    test.setTimeout(60_000)
    // No assignee and no team: anyone with conversation.view may open it.
    const seeded = seedConversation(marker)
    const threadUrl = `/admin/inbox?i=${seeded.conversationId}`
    const firstMessage = seeded.messages[0]

    const scoped = await asPerson('scoped')
    await scoped.goto(threadUrl)
    await expect(scoped.getByText(firstMessage).first()).toBeVisible({ timeout: 15_000 })

    // On main the pane itself still opens (with no messages) for a teammate
    // without conversation.view; the messages are what must never show.
    const noAccess = await asPerson('noAccess')
    await noAccess.goto(threadUrl)
    await expect(noAccess.getByText(/No messages yet|Conversation not found/)).toBeVisible({
      timeout: 15_000,
    })
    await expect(noAccess.getByText(firstMessage)).toHaveCount(0)
  })

  test('the customer is kept out of the admin', async ({ asPerson }) => {
    const customer = await asPerson('customer')
    await customer.goto('/admin/inbox')
    await expect(customer).not.toHaveURL(/\/admin\/inbox/, { timeout: 15_000 })
  })
})
