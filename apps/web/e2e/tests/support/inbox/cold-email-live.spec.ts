/**
 * CUS-E-07: a cold email that routing leaves unassigned appears in an open
 * team inbox live, without a refresh.
 */
import { fromUuid } from '@quackback/ids'
import { test, expect } from '../../../support/fixtures'
import { pollFor, supportDb } from '../../../support/db'
import { sendInboundEmail, supportInboxAddress } from '../../../support/inbound-email'

test.describe('cold email in the inbox', { tag: '@core' }, () => {
  test('a new unassigned email conversation shows up in an open inbox without a refresh', async ({
    request,
    asPerson,
    marker,
    customerEmail,
  }) => {
    const admin = await asPerson('admin')
    const inboxStream = admin.waitForRequest((r) => r.url().includes('/api/chat/stream'))
    await admin.goto('/admin/inbox')
    await inboxStream
    await expect(admin.getByRole('button', { name: 'New conversation' })).toBeVisible()

    const body = `Hello, ${marker} here.`
    const res = await sendInboundEmail(request, {
      from: customerEmail,
      to: supportInboxAddress(),
      subject: `Live ${marker}`,
      text: body,
      messageId: `<${marker}@customers.example>`,
    })
    expect(res.status(), await res.text()).toBe(200)

    // The case under test: routing left it unassigned, so routing published nothing.
    const sql = supportDb()
    const row = await pollFor(`the conversation for ${marker}`, async () => {
      const [r] = await sql<{ id: string; a: string | null; t: string | null }[]>`
        SELECT c.id, c.assigned_agent_principal_id AS a, c.assigned_team_id AS t
        FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.metadata ->> 'emailMessageId' LIKE ${`%${marker}@%`} LIMIT 1`
      return r ?? null
    })
    expect({ a: row.a, t: row.t }).toEqual({ a: null, t: null })

    // The row shows the first message as its preview.
    await expect(admin.getByText(body).first()).toBeVisible({ timeout: 15_000 })
    // And it is the conversation just created, reachable from that row.
    await admin.getByText(body).first().click()
    await expect(admin).toHaveURL(new RegExp(fromUuid('conversation', row.id)))
  })
})
