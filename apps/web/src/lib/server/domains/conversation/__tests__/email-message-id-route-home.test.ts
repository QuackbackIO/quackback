/**
 * The Message-ID route home, across the seam it actually crosses.
 *
 * A reply whose client dropped the plus-address is routed by matching the
 * `In-Reply-To` / `References` ids it quotes against the outbound ids we
 * recorded. That match spans three modules that no unit test puts together: the
 * transport reports an id, the store records it, and the inbound parser reads
 * the id off a real reply header. Each can be green on its own while the pair of
 * values can never be equal, which is exactly the shape the defect had — the
 * transport reported a bare id and the header on the wire carried it at a host.
 *
 * So this suite is deliberately end to end over the real modules, with only the
 * database faked. What it asserts is the RESOLUTION and never the string
 * identity of the two values: they are not equal by design, because the host in
 * the quoted form belongs to a provider region and only one region's host has
 * ever been observed. Storing a composed host would make the route home depend
 * on that guess; asserting the strings match would make a design that depends on
 * it look load-bearing. What has to hold is that the reply comes home.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendViaSes } from '@quackback/email/ses'
import type { SesSendClient } from '@quackback/email/ses'

/** The one table this suite needs, standing in for the tenant database. */
let outboundRows: Array<{ messageId: string; conversationId: string }> = []
/** The last predicate the store handed `where`, so `limit` can answer from it. */
let lastPredicate: { _t: string; vals?: unknown; val?: unknown } | undefined

vi.mock('@/lib/server/db', () => {
  const selectChain: Record<string, unknown> = {
    from: () => selectChain,
    where: (predicate: { _t: string; vals?: unknown; val?: unknown }) => {
      lastPredicate = predicate
      return selectChain
    },
    orderBy: () => selectChain,
    limit: async () => {
      // The resolver's lookup: exact equality against a set of candidates.
      if (lastPredicate?._t === 'inArray') {
        const wanted = lastPredicate.vals as string[]
        return outboundRows
          .filter((row) => wanted.includes(row.messageId))
          .map((row) => ({ conversationId: row.conversationId }))
      }
      // The References chain's lookup: this conversation's rows, newest first.
      if (lastPredicate?._t === 'eq') {
        return outboundRows
          .filter((row) => row.conversationId === lastPredicate?.val)
          .map((row) => ({ messageId: row.messageId }))
          .reverse()
      }
      return []
    },
  }
  return {
    db: {
      select: () => selectChain,
      insert: () => ({
        values: (row: { messageId: string; conversationId: string }) => ({
          onConflictDoNothing: async () => {
            if (!outboundRows.some((r) => r.messageId === row.messageId)) outboundRows.push(row)
          },
          onConflictDoUpdate: async () => undefined,
        }),
      }),
    },
    and: (...args: unknown[]) => ({ _t: 'and', args }),
    eq: (col: unknown, val: unknown) => ({ _t: 'eq', col, val }),
    inArray: (col: unknown, vals: unknown) => ({ _t: 'inArray', col, vals }),
    desc: (col: unknown) => ({ _t: 'desc', col }),
    isNull: (col: unknown) => ({ _t: 'isNull', col }),
    sql: () => ({ _t: 'sql' }),
    channelIdentities: {},
    conversationOutboundEmails: {
      messageId: 'conversationOutboundEmails.messageId',
      conversationId: 'conversationOutboundEmails.conversationId',
      createdAt: 'conversationOutboundEmails.createdAt',
    },
    conversationMessages: {
      metadata: 'conversationMessages.metadata',
      createdAt: 'conversationMessages.createdAt',
      conversationId: 'conversationMessages.conversationId',
      deletedAt: 'conversationMessages.deletedAt',
    },
  }
})

import { parseMessageIdList } from '../conversation.email-inbound'
import {
  recordOutboundEmail,
  resolveConversationByMessageIds,
  threadIdsForOutbound,
} from '../conversation.email-store'
import type { ConversationId } from '@quackback/ids'

const CONVERSATION = 'conversation_01k9route' as ConversationId

/** The id the API hands back: bare, with no host on it. */
const ASSIGNED = '0100019ff2b1fee9-05ecb9b8-4d5a-4c1e-9f0a-6ab2c3d4e5f6-000000'

/** One send through the real transport, against a client that answers as SES does. */
async function sendOne(
  region: string,
  headers?: Record<string, string>
): Promise<{ messageId: string; sentHeaders: Array<{ Name: string; Value: string }> }> {
  let sent: { input: { Content?: { Simple?: { Headers?: unknown } } } } | undefined
  const send = vi.fn(async (command: typeof sent) => {
    sent = command
    return { MessageId: ASSIGNED, $metadata: { httpStatusCode: 200 } }
  })
  const client = { send } as unknown as SesSendClient
  const result = await sendViaSes(
    {
      from: 'Support <support@platform.test>',
      to: 'customer@example.test',
      subject: 'Hello',
      ...(headers ? { headers } : {}),
    },
    { client, region }
  )
  return {
    messageId: result.messageId,
    sentHeaders: (sent?.input.Content?.Simple?.Headers ?? []) as Array<{
      Name: string
      Value: string
    }>,
  }
}

beforeEach(() => {
  outboundRows = []
  lastPredicate = undefined
})

describe('a reply quoting the id that went out', () => {
  it('routes home to the conversation it was recorded against', async () => {
    // Sent through the real transport, recorded through the real store.
    const { messageId } = await sendOne('us-east-1')
    await recordOutboundEmail(messageId, CONVERSATION)

    // The reply, as the recipient's client writes it: the id it was given, in
    // the form the header carried it.
    const candidates = parseMessageIdList(`<${ASSIGNED}@email.amazonses.com>`)

    expect(await resolveConversationByMessageIds(candidates)).toBe(CONVERSATION)
  })

  it('routes home from a region whose host is not the verified one', async () => {
    const { messageId } = await sendOne('eu-west-2')
    await recordOutboundEmail(messageId, CONVERSATION)

    const candidates = parseMessageIdList(`<${ASSIGNED}@eu-west-2.amazonses.com>`)

    expect(await resolveConversationByMessageIds(candidates)).toBe(CONVERSATION)
  })

  /**
   * The case that decides the design.
   *
   * Only one region's Message-ID host has ever been observed, so any host we
   * composed for another region would be an inference — and an inference that
   * turned out wrong would be SILENT, because a stored `id@wrong-host` matches
   * nothing a reply can quote and looks exactly like a client that stripped the
   * headers. Here the header carries a host nothing in this system would have
   * predicted, and the reply still comes home, because the row holds only what
   * the provider actually told us.
   */
  it('routes home even when the header host is one we would never have predicted', async () => {
    const { messageId } = await sendOne('ap-southeast-4')
    await recordOutboundEmail(messageId, CONVERSATION)

    const candidates = parseMessageIdList(`<${ASSIGNED}@smtp-out.ap-southeast-4.amazonses.com>`)

    expect(await resolveConversationByMessageIds(candidates)).toBe(CONVERSATION)
  })

  it('does not route home on a host that only looks like the provider one', async () => {
    // The tolerance is not a licence to ignore the host: it applies to the ids
    // this provider assigns, and a lookalike is a different id. Both shapes
    // here are domains someone else can register.
    const { messageId } = await sendOne('us-east-1')
    await recordOutboundEmail(messageId, CONVERSATION)

    expect(
      await resolveConversationByMessageIds(
        parseMessageIdList(`<${ASSIGNED}@amazonses.com.attacker.test>`)
      )
    ).toBeNull()
    expect(
      await resolveConversationByMessageIds(
        parseMessageIdList(`<${ASSIGNED}@evil.amazonses.com.attacker.test>`)
      )
    ).toBeNull()
    expect(
      await resolveConversationByMessageIds(parseMessageIdList(`<${ASSIGNED}@evilamazonses.com>`))
    ).toBeNull()
  })
})

/**
 * The other half of the seam: the chain the NEXT outbound mail carries. A
 * stored id is bare on this rung and a bare token is not a `msg-id`, so the
 * transport completes it — the one place a regional host is composed at all,
 * and a header rather than a row, where being wrong costs the recipient's
 * grouping and never a reply's route home.
 */
describe('the chain the next mail carries', () => {
  it('names the id the recipient was given, not the bare one we stored', async () => {
    const { messageId } = await sendOne('us-east-1')
    await recordOutboundEmail(messageId, CONVERSATION)

    // What the notify path builds its threading headers from.
    const prior = (await threadIdsForOutbound(CONVERSATION)).outbound
    expect(prior).toEqual([ASSIGNED])

    const { sentHeaders } = await sendOne('us-east-1', {
      'In-Reply-To': `<${prior[prior.length - 1]}>`,
      References: prior.map((id) => `<${id}>`).join(' '),
    })

    const quoted = `<${ASSIGNED}@email.amazonses.com>`
    expect(sentHeaders).toEqual([
      { Name: 'In-Reply-To', Value: quoted },
      { Name: 'References', Value: quoted },
    ])
    // And the token we just put on the wire is one a reply quoting it back
    // routes home from, so the two halves of the seam agree.
    expect(await resolveConversationByMessageIds(parseMessageIdList(quoted))).toBe(CONVERSATION)
  })
})
