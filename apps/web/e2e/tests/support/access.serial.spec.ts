/**
 * Team-access journeys that depend on who is online, so they run in the
 * support-serial project (one at a time, nothing else running): the
 * new-message bell for a follow-up visitor message is held back while an
 * available, in-scope teammate is online, and goes only to in-scope teammates.
 *
 * Journeys: RT-48, and the new-message half of ACC-14 (the assignment and
 * mention halves are in access.spec.ts).
 */
import { fromUuid, toUuid } from '@quackback/ids'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { bellsFor, waitForNotificationHook } from '../../support/access-bells'
import {
  conversationReplyAddress,
  sendInboundEmail,
  supportInboxAddress,
} from '../../support/inbound-email'
import { emailLogFor } from '../../support/mailpit'
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

/** A teammate's new-message bells on this conversation whose text contains `text`. */
const bellsWith = async (t: TestTeammate, conversationId: string, text: string) =>
  (await bellsFor(t.principalId, conversationId)).filter(
    (b) => b.type === 'chat_message' && (b.body ?? '').includes(text)
  )

/** Wait for a teammate's new-message bell carrying `text`. */
const waitForBell = (t: TestTeammate, conversationId: string, text: string) =>
  pollFor(`a new-message bell "${text}" for ${t.name}`, async () =>
    (await bellsWith(t, conversationId, text)).length > 0 ? true : null
  )

/** The app's outbound mail rows for an address about a conversation since a moment. */
const mailSince = async (address: string, conversationId: string, since: Date) =>
  (await emailLogFor(address)).filter(
    (r) =>
      r.direction === 'outbound' &&
      r.conversation_id === toUuid(conversationId as `conversation_${string}`) &&
      r.created_at >= since
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
    await waitForBell(t1, conv, `First message ${marker}`)

    const admin = await personApi(playwright, 'admin')
    const moved = await callServerFn(admin, 'assignConversationTeamFn', {
      conversationId: conv,
      teamId: teamA.id,
    })
    expect(moved.ok, moved.error).toBe(true)

    // Follow-up while T1 (in scope, available) is online: held. The hook
    // decides when it runs, so presence stays put until it has.
    const held = `${marker} follow-up held`
    await followUp(request, customerEmail, conv, held)
    await waitForNotificationHook(held)
    expect(await bellsWith(t1, conv, held)).toEqual([])

    // T1 goes Away: the next follow-up rings although T1 is still connected.
    await setAvailability(t1.principalId, 'away')
    const away = `${marker} follow-up while away`
    await followUp(request, customerEmail, conv, away)
    await waitForBell(t1, conv, away)

    // Back online and available, then offline: only an out-of-scope teammate is
    // online, which holds nothing.
    await setAvailability(t1.principalId, 'online')
    t1Online.close()
    await pollFor('T1 offline', async () =>
      (await presenceRows(t1.principalId)).length === 0 ? true : null
    )
    await online(outsider)
    const nobody = `${marker} follow-up nobody in scope`
    await followUp(request, customerEmail, conv, nobody)
    await waitForBell(t1, conv, nobody)

    // The held follow-up never rang, later or otherwise; the outsider heard
    // only the first message (then in the Unassigned queue, so everyone's).
    expect(await bellsWith(t1, conv, held)).toEqual([])
    expect(await bellsWith(outsider, conv, `First message ${marker}`)).toHaveLength(1)
    expect(await bellsWith(outsider, conv, `${marker} follow-up`)).toEqual([])
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
    // In the Unassigned queue the first message reaches S too: the control
    // that S can hear about this conversation at all.
    await waitForBell(s, conv, `First message ${marker}`)
    // With nobody online the first message mails S as well. Wait for that mail
    // so it lands before the window below opens and is never mistaken for one
    // about the follow-up.
    const start = new Date(0)
    await pollFor('S mail for the first message', async () =>
      (await mailSince(s.email, conv, start)).length > 0 ? true : null
    )
    const admin = await personApi(playwright, 'admin')
    const moved = await callServerFn(admin, 'assignConversationTeamFn', {
      conversationId: conv,
      teamId: teamB.id,
    })
    expect(moved.ok, moved.error).toBe(true)

    // Nobody is online, so the follow-up rings and mails team B.
    const since = new Date()
    const text = `${marker} follow-up for team B`
    await followUp(request, customerEmail, conv, text)
    await waitForBell(b1, conv, text)
    // email_log records each address the app chose to mail, whatever the SMTP
    // stand-in then did with it.
    await pollFor('team B mail for the follow-up', async () =>
      (await mailSince(b1.email, conv, since)).length > 0 ? true : null
    )
    await waitForNotificationHook(text)

    expect(await bellsWith(s, conv, text)).toEqual([])
    expect(await mailSince(s.email, conv, since)).toEqual([])
    await admin.dispose()
  }
)
