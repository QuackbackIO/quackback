/**
 * One email per teammate reply on a customer ticket (CUS-O-17).
 *
 * A customer ticket is paired with a conversation, so a teammate's reply lands
 * there whether it was sent from the ticket or from the conversation. The
 * customer gets one email for it, and the ticket's watchers hear about it
 * either way.
 *
 * "Exactly one" needs a positive signal that every email the reply could
 * cause has gone out before counting: a teammate who watches the ticket gets
 * the ticket reply email, which rides the same `ticket.replied` signal as the
 * customer's old second copy.
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import {
  INBOX_PERMISSIONS,
  apiFor,
  backingConversationOf,
  createKey,
  expectJson,
  newTeammate,
  seedCustomer,
  uuidOf,
} from '../../support/api-client'
import { getMail, mailTo } from '../../support/mailpit'
import { setFeatureFlag } from '../../utils/db-helpers'

test.describe.configure({ timeout: 90_000 })

// Ticket emails go out only with tickets on. Only ever turned on.
test.beforeAll(() => setFeatureFlag('supportTickets', true))

/** Mail to `address` whose text carries `needle`. */
async function mailCarrying(address: string, needle: string) {
  const found = []
  for (const summary of await mailTo(address)) {
    const message = await getMail(summary.ID)
    if (message.Text.includes(needle) || message.HTML.includes(needle)) found.push(message)
  }
  return found
}

async function watch(ticketId: string, principalId: string): Promise<void> {
  const sql = supportDb()
  await sql`INSERT INTO ticket_subscriptions (id, ticket_id, principal_id, reason)
            VALUES (${uuidOf(generateId('ticket_sub'))}, ${uuidOf(ticketId)},
                    ${uuidOf(principalId)}, 'manual')`
}

for (const via of ['ticket', 'conversation'] as const) {
  test(
    `CUS-O-17 a reply sent from the ${via} reaches the customer once and tells the watchers`,
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const customerEmail = `${marker}@customers.example`
      const customer = await seedCustomer(customerEmail)
      const admin = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
      const workspace = await apiFor(playwright, baseURL, admin.key)
      const ticket = (
        await expectJson(
          await workspace.post('/api/v1/tickets', {
            data: { title: `Export fails ${marker}`, requesterPrincipalId: customer.principalId },
          }),
          201
        )
      ).data
      const conversationId = (await backingConversationOf(ticket.id))!
      expect(conversationId).toBeTruthy()

      const watcher = newTeammate(`Watcher ${marker}`, [...INBOX_PERMISSIONS, 'ticket.view_all'])
      await watch(ticket.id, watcher.principalId)

      const replier = createKey({ creatorEmail: people.people.admin.email })
      const api = await apiFor(playwright, baseURL, replier.key)
      const answer = `Answer from the ${via} ${marker}`
      const path =
        via === 'ticket'
          ? `/api/v1/tickets/${ticket.id}/reply`
          : `/api/v1/conversations/${conversationId}/reply`
      await expectJson(await api.post(path, { data: { content: answer } }), 201)

      // The customer's email, then the watcher's: the latter is the ticket
      // reply email, so the signal has fanned out by the time it lands.
      await expect
        .poll(() => mailCarrying(customerEmail, answer).then((m) => m.length), { timeout: 30_000 })
        .toBeGreaterThan(0)
      await expect
        .poll(() => mailCarrying(watcher.email, answer).then((m) => m.length), { timeout: 30_000 })
        .toBe(1)
      // A second copy to the customer, had there been one, rides the same
      // signal as the watcher's email; give its job a moment past it.
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      expect(await mailCarrying(customerEmail, answer)).toHaveLength(1)

      await api.dispose()
      await workspace.dispose()
    }
  )
}
