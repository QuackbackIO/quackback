/**
 * Email-channel persistence: the outbound Message-ID threading map and the
 * channel-identity resolver. Verifies Message-ID/address normalization and the
 * shapes the ingest core and notify path depend on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let selectRows: Array<Record<string, unknown>> = []
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
    limit: async () => selectRows,
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
  }
})

import {
  resolveConversationByMessageIds,
  resolvePrincipalIdByEmail,
  recordOutboundEmail,
  recordEmailIdentity,
  priorOutboundMessageIds,
} from '../conversation.email-store'

beforeEach(() => {
  vi.clearAllMocks()
  selectRows = []
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
})
