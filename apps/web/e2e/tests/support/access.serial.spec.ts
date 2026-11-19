/**
 * Team-access journeys that depend on who is online, so they run in the
 * support-serial project (one at a time, nothing else running): the
 * new-message bell for a follow-up visitor message is held back while an
 * available, in-scope teammate is online, and goes only to in-scope teammates.
 *
 * Journeys: RT-48, and the new-message half of ACC-14 (the assignment and
 * mention halves are in access.spec.ts).
 */
import { fromUuid } from '@quackback/ids'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { bellsFor } from '../../support/access-bells'
import {
  conversationReplyAddress,
  sendInboundEmail,
  supportInboxAddress,
} from '../../support/inbound-email'
import { emailLogFor, waitForEmailLog } from '../../support/mailpit'
import { presenceRows, setAvailability } from '../../support/presence'
import { callServerFn, personApi } from '../../support/server-fns'
import { openStream, type OpenStream } from '../../support/streams'
import { createTeam, type TestTeammate } from '../../support/teammates'

let streams: OpenStream[] = []

test.beforeEach(async () => {
  // Nothing else runs in this project; start with nobody online.
  await supportDb()`DELETE FROM presence_stream`
})
test.afterEach(() => {
  for (const s of streams) s.close()
  streams = []
})

/** Put a teammate online (a presence stream, as their admin tab opens). */
async function online(t: TestTeammate): Promise<OpenStream> {
  const s = await openStream({ cookie: t.cookie, query: { scope: 'presence' } })
  expect(s.status).toBe(200)
  streams.push(s)
  await pollFor(`presence for ${t.name}`, async () => {
    const rows = await presenceRows(t.principalId)
    return rows.length > 0 ? true : null
  })
  return s
}

/** A cold email from a customer opens a conversation; returns its id. */
async function emailConversation(
  request: APIRequestContext,
  from: string,
  marker: string
): Promise<string> {
  const messageId = `<${marker}-open@customers.example>`
  const res = await sendInboundEmail(request, {
    from,
    to: supportInboxAddress(),
    subject: `Question ${marker}`,
    text: `First message ${marker}`,
    messageId,
  })
  expect(res.status(), await res.text()).toBe(200)
  return pollFor('the emailed conversation', async () => {
    const [row] = await supportDb()`
      SELECT conversation_id FROM conversation_messages
      WHERE metadata ->> 'emailMessageId' LIKE ${`%${marker}-open@customers.example%`} LIMIT 1`
    return row ? fromUuid('conversation', row.conversation_id as string) : null
  })
}

/** A follow-up email from the same customer into the conversation. */
async function followUp(
  request: APIRequestContext,
  from: string,
  conversationId: string,
  text: string
): Promise<void> {
  const res = await sendInboundEmail(request, {
    from,
    to: conversationReplyAddress(conversationId),
    subject: `Re: ${text}`,
    text,
  })
  expect(res.status()).toBe(200)
  expect(await res.json()).toMatchObject({ status: 'ingested' })
}

const messageBells = async (t: TestTeammate, conversationId: string) =>
  (await bellsFor(t.principalId, conversationId)).filter((b) => b.type === 'chat_message')

/** Wait for a teammate's n-th new-message bell on this conversation. */
const bellCount = (t: TestTeammate, conversationId: string, n: number) =>
  pollFor(`${n} new-message bells for ${t.name}`, async () =>
    (await messageBells(t, conversationId)).length >= n ? true : null
  )

test(
  'RT-48 the follow-up bell is held only while an available, in-scope teammate is online; the first message always rings',
  { tag: '@core' },
  async ({ request, playwright, customerEmail, marker, newTeammate }) => {
    test.setTimeout(90_000)
    const teamA = await createTeam(`${marker}-a`)
    const teamB = await createTeam(`${marker}-b`)
    const t1 = await newTeammate({ roleKey: 'e2e_scoped_agent', teams: [teamA.id] })
    const outsider = await newTeammate({ roleKey: 'e2e_scoped_agent', teams: [teamB.id] })

    // First message, with T1 online and available: it still rings.
    const t1Online = await online(t1)
    const conv = await emailConversation(request, customerEmail, marker)
    await bellCount(t1, conv, 1)

    const admin = await personApi(playwright, 'admin')
    expect(
      (
        await callServerFn(admin, 'assignConversationTeamFn', {
          conversationId: conv,
          teamId: teamA.id,
        })
      ).ok
    ).toBe(true)

    // Follow-up while T1 (in scope, available) is online: held.
    await followUp(request, customerEmail, conv, `${marker} follow-up held`)
    // T1 goes Away: the next follow-up rings although T1 is still connected.
    await setAvailability(t1.principalId, 'away')
    await followUp(request, customerEmail, conv, `${marker} follow-up while away`)
    await bellCount(t1, conv, 2)

    // Back online and available, then offline: only an out-of-scope teammate is
    // online, which holds nothing.
    await setAvailability(t1.principalId, 'online')
    t1Online.close()
    await pollFor('T1 offline', async () => {
      const rows = await presenceRows(t1.principalId)
      return rows.length === 0 ? true : null
    })
    await online(outsider)
    await followUp(request, customerEmail, conv, `${marker} follow-up nobody in scope`)
    await bellCount(t1, conv, 3)

    // Exactly three: the held follow-up never produced one.
    expect(await messageBells(t1, conv)).toHaveLength(3)
    // The outsider heard the first message (then in the Unassigned queue, so in
    // everyone's scope) and none of the follow-ups on team A.
    expect(await messageBells(outsider, conv)).toHaveLength(1)
    await admin.dispose()
  }
)

test(
  "ACC-14 a new message on another team's conversation gives a scoped teammate no bell and no email",
  { tag: '@smoke' },
  async ({ request, playwright, customerEmail, marker, newTeammate }) => {
    test.setTimeout(60_000)
    const teamA = await createTeam(`${marker}-a`)
    const teamB = await createTeam(`${marker}-b`)
    const s = await newTeammate({ roleKey: 'e2e_scoped_agent', teams: [teamA.id] })
    const b1 = await newTeammate({ roleKey: 'e2e_scoped_agent', teams: [teamB.id] })
    const conv = await emailConversation(request, customerEmail, marker)
    const admin = await personApi(playwright, 'admin')
    expect(
      (
        await callServerFn(admin, 'assignConversationTeamFn', {
          conversationId: conv,
          teamId: teamB.id,
        })
      ).ok
    ).toBe(true)
    const sBellsBefore = (await messageBells(s, conv)).length

    // Nobody is online, so the follow-up rings and mails team B.
    await followUp(request, customerEmail, conv, `${marker} follow-up for team B`)
    await bellCount(b1, conv, 2)
    // email_log records each address the app chose to mail, whatever the SMTP
    // stand-in did with it; S was never one of them.
    await waitForEmailLog(b1.email, {
      direction: 'outbound',
      email_type: 'ConversationMessageEmail',
    })

    expect(await messageBells(s, conv)).toHaveLength(sBellsBefore)
    const sMail = (await emailLogFor(s.email)).filter((r) => r.direction === 'outbound')
    // S was in scope for the first message only (then in the Unassigned queue).
    expect(sMail.length).toBeLessThanOrEqual(1)
    const b1Mail = (await emailLogFor(b1.email)).filter((r) => r.direction === 'outbound')
    expect(b1Mail.length).toBe(sMail.length + 1)
    await admin.dispose()
  }
)
