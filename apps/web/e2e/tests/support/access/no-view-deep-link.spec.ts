/**
 * ACC-05 for a teammate whose role has no inbox view permission: opening a
 * conversation by its link shows the in-shell "You don't have access" page,
 * as any admin page they cannot open, with nothing to close or reply to. Both an
 * Unassigned-queue conversation (no assignee, no team) and one assigned to
 * someone else.
 */
import type { APIRequestContext } from '@playwright/test'
import { fromUuid, toUuid } from '@quackback/ids'
import { test, expect } from '../../../support/fixtures'
import { pollFor, supportDb } from '../../../support/db'
import { sendInboundEmail, supportInboxAddress } from '../../../support/inbound-email'

/** Open an email conversation with a cold inbound mail and return its id. */
async function coldConversation(
  request: APIRequestContext,
  from: string,
  tag: string
): Promise<string> {
  const res = await sendInboundEmail(request, {
    from,
    to: supportInboxAddress(),
    subject: `Help ${tag}`,
    text: `Hello ${tag}`,
    messageId: `<${tag}@customers.example>`,
  })
  expect(res.status(), await res.text()).toBe(200)
  const sql = supportDb()
  const row = await pollFor(`a conversation for ${tag}`, async () => {
    const [r] = await sql<{ id: string }[]>`
      SELECT c.id FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.metadata ->> 'emailMessageId' LIKE ${`%${tag}@%`} LIMIT 1`
    return r ?? null
  })
  return fromUuid('conversation', row.id)
}

test.describe('a teammate without conversation.view', { tag: '@core' }, () => {
  test('opening a conversation by link shows no access, with no Close or reply', async ({
    request,
    people,
    asPerson,
    marker,
    customerEmail,
  }) => {
    const sql = supportDb()
    const unassigned = await coldConversation(request, customerEmail, `${marker}-u`)
    const assigned = await coldConversation(request, customerEmail, `${marker}-a`)
    await sql`UPDATE conversations SET assigned_agent_principal_id = ${toUuid(people.people.admin.principalId)}
      WHERE id = ${toUuid(assigned)}`
    // The case under test is the Unassigned queue: routing must not have taken it.
    const [row] = await sql<{ a: string | null; t: string | null }[]>`
      SELECT assigned_agent_principal_id AS a, assigned_team_id AS t FROM conversations
      WHERE id = ${toUuid(unassigned)}`
    expect(row).toEqual({ a: null, t: null })

    const page = await asPerson('noAccess')
    for (const id of [unassigned, assigned]) {
      await page.goto(`/admin/inbox?i=${id}`)
      await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByRole('button', { name: /^close$/i })).toHaveCount(0)
      await expect(page.locator('[contenteditable="true"]')).toHaveCount(0)
    }
  })
})
