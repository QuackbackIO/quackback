/**
 * Blocking a person stops automated email to them, but a teammate's own reply
 * still reaches them.
 *
 * A ticket filed for a blocked customer sends them no "we received your
 * ticket" email. A teammate's reply on it still arrives. The positive signal
 * that the ticket's queued emails have all run is a watching teammate's ticket
 * reply email: it queues behind the confirmation, so once it lands the count
 * of other mail to the customer means something. Ticket emails need tickets
 * on, which the setup project does.
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
  fixture,
  newTeammate,
  seedCustomer,
  uuidOf,
} from '../../support/api-client'
import { getMail, mailTo } from '../../support/mailpit'

test.describe.configure({ timeout: 90_000 })

test(
  'a blocked customer gets no ticket confirmation, but a reply still reaches them',
  { tag: '@core' },
  async ({ playwright, baseURL, people, marker }) => {
    const customerEmail = `${marker}@customers.example`
    const customer = await seedCustomer(customerEmail)
    fixture({ op: 'block', principalId: customer.principalId })

    const admin = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
    const workspace = await apiFor(playwright, baseURL, admin.key)
    const ticket = (
      await expectJson(
        await workspace.post('/api/v1/tickets', {
          data: { title: `Refund ${marker}`, requesterPrincipalId: customer.principalId },
        }),
        201
      )
    ).data
    expect(await backingConversationOf(ticket.id)).toBeTruthy()
    const watcher = newTeammate(`Watcher ${marker}`, [...INBOX_PERMISSIONS, 'ticket.view_all'])
    await supportDb()`INSERT INTO ticket_subscriptions (id, ticket_id, principal_id, reason)
      VALUES (${uuidOf(generateId('ticket_sub'))}, ${uuidOf(ticket.id)},
              ${uuidOf(watcher.principalId)}, 'manual')`

    const replier = createKey({ creatorEmail: people.people.admin.email })
    const api = await apiFor(playwright, baseURL, replier.key)
    const answer = `Your refund is on its way ${marker}`
    await expectJson(
      await api.post(`/api/v1/tickets/${ticket.id}/reply`, { data: { content: answer } }),
      201
    )

    const all = async () => Promise.all((await mailTo(customerEmail)).map((m) => getMail(m.ID)))
    const carries = (m: { Text: string; HTML: string }) =>
      m.Text.includes(answer) || m.HTML.includes(answer)

    await expect
      .poll(async () => (await all()).filter(carries).length, { timeout: 30_000 })
      .toBeGreaterThan(0)
    await expect
      .poll(
        async () =>
          (await Promise.all((await mailTo(watcher.email)).map((m) => getMail(m.ID)))).filter(
            carries
          ).length,
        { timeout: 30_000 }
      )
      .toBe(1)
    const others = (await all()).filter((m) => !carries(m)).map((m) => m.Subject)
    expect(others).toEqual([])

    await api.dispose()
    await workspace.dispose()
  }
)
