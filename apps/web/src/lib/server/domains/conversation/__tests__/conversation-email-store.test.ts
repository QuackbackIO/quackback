/**
 * Email-channel persistence: the outbound Message-ID threading map and the
 * channel-identity resolver. Verifies Message-ID/address normalization and the
 * shapes the ingest core and notify path depend on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let selectRows: Array<Record<string, unknown>> = []
let selectQueue: Array<Array<Record<string, unknown>>> = []
let insertedValues: Record<string, unknown> | undefined
let upsertConfig: { target?: unknown; set?: Record<string, unknown> } | undefined
const { eqSpy, inArraySpy } = vi.hoisted(() => ({
  eqSpy: vi.fn((col: unknown, val: unknown) => ({ _t: 'eq', col, val })),
  inArraySpy: vi.fn((col: unknown, vals: unknown) => ({ _t: 'inArray', col, vals })),
}))

vi.mock('@/lib/server/db', () => {
  const selectChain: Record<string, unknown> = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: async () => (selectQueue.length > 0 ? selectQueue.shift()! : selectRows),
  }
  return {
    db: {
      select: () => selectChain,
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          insertedValues = v
          return {
            onConflictDoNothing: async () => undefined,
            onConflictDoUpdate: async (cfg: {
              target?: unknown
              set?: Record<string, unknown>
            }) => {
              upsertConfig = cfg
            },
          }
        },
      }),
    },
    and: (...args: unknown[]) => ({ _t: 'and', args }),
    eq: eqSpy,
    inArray: inArraySpy,
    desc: (col: unknown) => ({ _t: 'desc', col }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      _t: 'sql',
      strings: [...strings],
      values,
    }),
    channelIdentities: {
      channel: 'channelIdentities.channel',
      externalId: 'channelIdentities.externalId',
      principalId: 'channelIdentities.principalId',
      verified: 'channelIdentities.verified',
    },
    conversationOutboundEmails: {
      messageId: 'conversationOutboundEmails.messageId',
      conversationId: 'conversationOutboundEmails.conversationId',
      createdAt: 'conversationOutboundEmails.createdAt',
    },
    conversationMessages: {
      metadata: 'conversationMessages.metadata',
      conversationId: 'conversationMessages.conversationId',
      createdAt: 'conversationMessages.createdAt',
      deletedAt: 'conversationMessages.deletedAt',
    },
    isNull: (col: unknown) => ({ _t: 'isNull', col }),
  }
})

import {
  resolveConversationByMessageIds,
  resolvePrincipalIdByEmail,
  recordOutboundEmail,
  recordEmailIdentity,
  priorOutboundMessageIds,
  priorInboundEmailMessageIds,
  threadIdsForOutbound,
} from '../conversation.email-store'

beforeEach(() => {
  vi.clearAllMocks()
  selectRows = []
  selectQueue = []
  insertedValues = undefined
  upsertConfig = undefined
})

describe('resolveConversationByMessageIds', () => {
  it('normalizes + dedupes candidates and returns the matched conversation id', async () => {
    selectRows = [{ conversationId: 'conversation_abc' }]

    const result = await resolveConversationByMessageIds(['<A@D>', 'a@d', 'b@d'])

    expect(result).toBe('conversation_abc')
    expect(inArraySpy).toHaveBeenCalledWith('conversationOutboundEmails.messageId', ['a@d', 'b@d'])
  })

  it('short-circuits to null on an empty candidate set (no query)', async () => {
    const result = await resolveConversationByMessageIds([])
    expect(result).toBeNull()
    expect(inArraySpy).not.toHaveBeenCalled()
  })

  it('returns null when nothing matches', async () => {
    selectRows = []
    expect(await resolveConversationByMessageIds(['x@d'])).toBeNull()
  })

  it('also looks for the bare form of an id the sending provider assigned', async () => {
    // Rows for that provider hold the id without its host, because that is what
    // its API reports and nothing composes the rest. Matching only what the
    // reply quotes would strand every one of them.
    selectRows = [{ conversationId: 'conversation_abc' }]

    await resolveConversationByMessageIds(['<0100018F-ABC@email.amazonses.com>'])

    expect(inArraySpy).toHaveBeenCalledWith('conversationOutboundEmails.messageId', [
      '0100018f-abc@email.amazonses.com',
      '0100018f-abc',
    ])
  })

  /**
   * The tolerance above is scoped to the hosts the provider stamps on its own
   * ids. Dropping a host anywhere else would let a local part alone decide a
   * match, and a local part alone is not what distinguishes one sending
   * domain's ids from another's.
   *
   * The last two are the hosts an attacker can register: each is admitted by
   * deleting one anchor from the recogniser's pattern, and each is a domain for
   * sale. A lookalike with no leading label fails with or without either
   * anchor, so it cannot stand in for them.
   */
  it('keeps the host on every other id, lookalikes at either end included', async () => {
    selectRows = []

    await resolveConversationByMessageIds([
      'c.abc.n1@workspace-a.test',
      'c.abc.n1@amazonses.com.attacker.test',
      '0100018f-abc@evil.amazonses.com.attacker.test',
      '0100018f-abc@evilamazonses.com',
    ])

    expect(inArraySpy).toHaveBeenCalledWith('conversationOutboundEmails.messageId', [
      'c.abc.n1@workspace-a.test',
      'c.abc.n1@amazonses.com.attacker.test',
      '0100018f-abc@evil.amazonses.com.attacker.test',
      '0100018f-abc@evilamazonses.com',
    ])
  })

  it('offers no extra candidate for an id carrying more than one at-sign', async () => {
    // The narrowness the doc claims, enforced: what the extra candidate may be
    // is a WHOLE provider-assigned id, never a fragment of some longer id that
    // happens to end at the provider's domain.
    selectRows = []

    await resolveConversationByMessageIds(['a@b@email.amazonses.com'])

    expect(inArraySpy).toHaveBeenCalledWith('conversationOutboundEmails.messageId', [
      'a@b@email.amazonses.com',
    ])
  })
})

describe('resolvePrincipalIdByEmail', () => {
  it('looks up the email channel with a lower-cased address', async () => {
    selectRows = [{ principalId: 'principal_v' }]

    const result = await resolvePrincipalIdByEmail('Jane@Example.COM')

    expect(result).toBe('principal_v')
    expect(eqSpy).toHaveBeenCalledWith('channelIdentities.channel', 'email')
    expect(eqSpy).toHaveBeenCalledWith('channelIdentities.externalId', 'jane@example.com')
  })

  it('returns null with no identity on file', async () => {
    expect(await resolvePrincipalIdByEmail('nobody@x.com')).toBeNull()
  })
})

describe('recordOutboundEmail', () => {
  it('stores the Message-ID bare and lower-cased', async () => {
    await recordOutboundEmail('<C.ABC.N1@Domain.Example>', 'conversation_abc' as never)
    expect(insertedValues).toEqual({
      messageId: 'c.abc.n1@domain.example',
      conversationId: 'conversation_abc',
    })
  })
})

describe('recordEmailIdentity', () => {
  it('stores a lower-cased address, unverified by default', async () => {
    await recordEmailIdentity('Jane@Example.com', 'principal_v' as never)
    expect(insertedValues).toEqual({
      channel: 'email',
      externalId: 'jane@example.com',
      principalId: 'principal_v',
      verified: false,
    })
  })

  it('upgrades verified one-way on conflict (existing OR incoming), never downgrading', async () => {
    // A verified write inserts verified=true; on conflict the SET keeps the row
    // verified whenever either side is true, so an observed row is promoted and
    // a verified row is never demoted by a later observed write.
    await recordEmailIdentity('jane@example.com', 'principal_v' as never, true)
    expect(insertedValues?.verified).toBe(true)
    expect(upsertConfig?.target).toEqual([
      'channelIdentities.channel',
      'channelIdentities.externalId',
    ])
    // The only field an existing row takes is the OR-upgraded verified flag.
    expect(Object.keys(upsertConfig?.set ?? {})).toEqual(['verified'])
    expect(upsertConfig?.set?.verified).toMatchObject({
      _t: 'sql',
      strings: ['', ' OR excluded.verified'],
      values: ['channelIdentities.verified'],
    })
  })
})

describe('priorOutboundMessageIds', () => {
  it('returns stored ids oldest-first (reversing the newest-first fetch)', async () => {
    selectRows = [{ messageId: 'newest@d' }, { messageId: 'oldest@d' }]
    const result = await priorOutboundMessageIds('conversation_abc' as never)
    expect(result).toEqual(['oldest@d', 'newest@d'])
  })

  it('keeps a hostless id in the chain for the transport to finish', async () => {
    // A hostless row is what a provider that assigns its own id reports, and it
    // is the ordinary case on that rung rather than a legacy one. Dropping it
    // here would empty the chain on exactly the rung the ids come from; the
    // transport that reported the id is the one that knows the host its header
    // carried, and it completes the token on the way out.
    selectRows = [{ messageId: 'newest@d' }, { messageId: '0100018f-abc' }, { messageId: 'old@d' }]
    const result = await priorOutboundMessageIds('conversation_abc' as never)
    expect(result).toEqual(['old@d', '0100018f-abc', 'newest@d'])
  })
})

describe('priorInboundEmailMessageIds', () => {
  it('returns inbound Message-IDs oldest-first', async () => {
    selectRows = [{ messageId: 'cust-new@x' }, { messageId: 'cust-old@x' }]
    const result = await priorInboundEmailMessageIds('conversation_abc' as never)
    expect(result).toEqual(['cust-old@x', 'cust-new@x'])
  })

  it('drops transport dedupe keys that are not RFC Message-IDs', async () => {
    selectRows = [{ messageId: 'qb-transport:ses-1' }, { messageId: 'cust@x' }]
    const result = await priorInboundEmailMessageIds('conversation_abc' as never)
    expect(result).toEqual(['cust@x'])
  })
})

describe('threadIdsForOutbound', () => {
  it('merges inbound and outbound ids in created-at order', async () => {
    const t1 = new Date('2026-08-16T09:00:00Z')
    const t2 = new Date('2026-08-16T10:00:00Z')
    const t3 = new Date('2026-08-16T11:00:00Z')
    // Query order: outbound, then inbound. Each page is newest-first.
    selectQueue = [
      [
        { messageId: 'ours-2@x', createdAt: t3 },
        { messageId: 'ours-1@x', createdAt: t2 },
      ],
      [{ messageId: 'cust-1@x', createdAt: t1 }],
    ]

    const result = await threadIdsForOutbound('conversation_abc' as never)

    expect(result.inbound).toEqual(['cust-1@x'])
    expect(result.outbound).toEqual(['ours-1@x', 'ours-2@x'])
    expect(result.merged).toEqual(['cust-1@x', 'ours-1@x', 'ours-2@x'])
  })
})
