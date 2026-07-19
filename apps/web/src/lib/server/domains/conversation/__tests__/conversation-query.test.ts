/**
 * Pure DTO mappers + the small batch loader in conversation.query. Covers the
 * normalization/defaulting branches (attachments → [], visitorEmail → null,
 * csatRating null-coalesce, ISO timestamps, null read-watermarks,
 * displayName/avatarUrl null-coalesce) and the loader's dedupe / empty-input /
 * map-building behavior against a thenable db-chain mock. The big
 * listConversationsForAgent SQL builder is intentionally not exercised here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConversationId,
  ConversationMessageId,
  PrincipalId,
  SegmentId,
  CompanyId,
} from '@quackback/ids'
import type { Conversation, ConversationMessage } from '@/lib/server/db'
import type { ConversationAuthorDTO } from '@/lib/shared/conversation/types'

// Drives what the terminal db-chain promise resolves to per test.
let principalRows: Array<{
  id: PrincipalId
  displayName: string | null
  avatarUrl: string | null
}> = []
// Records the argument handed to inArray so we can assert dedupe behavior.
const inArrayCalls: unknown[][] = []

vi.mock('@/lib/server/db', () => {
  // Thenable chain: every builder method returns the same chain, and the chain
  // itself resolves (via .then) to the row set the active query expects. We
  // pick principal rows off the table passed to .from().
  function makeChain() {
    let kind: 'principal' | 'unknown' = 'unknown'
    const chain: Record<string, unknown> = {}
    const passthrough = () => chain
    chain.select = passthrough
    chain.from = (t: { __name?: string }) => {
      kind = t?.__name === 'principal' ? 'principal' : 'unknown'
      return chain
    }
    chain.innerJoin = passthrough
    chain.leftJoin = passthrough
    chain.where = passthrough
    chain.orderBy = passthrough
    chain.limit = passthrough
    chain.then = (resolve: (rows: unknown[]) => unknown) =>
      resolve(kind === 'principal' ? principalRows : [])
    return chain
  }

  return {
    db: {
      select: () => makeChain(),
      selectDistinct: () => makeChain(),
    },
    // Tables — only __name matters for routing the chain.
    principal: { __name: 'principal' },
    user: { __name: 'user', id: 'id', image: 'image', imageKey: 'image_key' },
    conversations: { __name: 'conversations' },
    conversationMessages: { __name: 'conversation_messages' },
    conversationMessageMentions: { __name: 'conversation_message_mentions' },
    conversationMessageReactions: {
      __name: 'conversation_message_reactions',
      conversationMessageId: 'conversation_message_id',
      emoji: 'emoji',
      principalId: 'principal_id',
    },
    conversationMessageFlags: {
      __name: 'conversation_message_flags',
      conversationMessageId: 'conversation_message_id',
      principalId: 'principal_id',
      flaggedAt: 'flagged_at',
    },
    userSegments: { __name: 'user_segments' },
    segments: { __name: 'segments' },
    // SQL helpers — no-op stubs; inArray records its second arg for assertions.
    eq: vi.fn(),
    and: vi.fn(),
    or: vi.fn(),
    lt: vi.fn(),
    gt: vi.fn(),
    isNull: vi.fn(),
    isNotNull: vi.fn(),
    desc: vi.fn(),
    asc: vi.fn(),
    sql: vi.fn(),
    inArray: vi.fn((_col: unknown, values: unknown[]) => {
      inArrayCalls.push(values)
      return {}
    }),
  }
})

import {
  toMessageDTO,
  toConversationDTO,
  authorFromInput,
  fallbackAuthor,
  loadAuthors,
  listConversationsForAgent,
  resolveVisitorConversation,
  enrichMessagesForAgent,
  sortDescriptorFor,
  slaDueAtFor,
  slaDtoFor,
  translationStateFrom,
} from '../conversation.query'
import { isNull, isNotNull, eq } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'

// The RBAC wiring (UNIFIED-INBOX-SPEC.md §6) ANDs conversationFilter(actor)
// into every call; a service actor short-circuits to `sql\`true\`` with no
// extra eq/isNull/inArray calls, so every pre-existing assertion in this file
// (which count those mocks) stays valid unchanged.
const serviceActor: Actor = {
  principalId: null,
  role: null,
  principalType: 'service',
  segmentIds: new Set(),
}

const visitorId = 'principal_visitor' as PrincipalId
const agentId = 'principal_agent' as PrincipalId
const conversationId = 'conversation_1' as ConversationId
const messageId = 'conversation_msg_1' as ConversationMessageId

const visitorAuthor: ConversationAuthorDTO = {
  principalId: visitorId,
  displayName: 'Jane',
  avatarUrl: null,
}

function makeMessage(extra: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: messageId,
    conversationId,
    principalId: visitorId,
    senderType: 'visitor',
    content: 'hello',
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    attachments: null,
    isInternal: false,
    deletedAt: null,
    ...extra,
  } as unknown as ConversationMessage
}

function makeConversation(extra: Partial<Conversation> = {}): Conversation {
  return {
    id: conversationId,
    visitorPrincipalId: visitorId,
    assignedAgentPrincipalId: null,
    status: 'open',
    subject: null,
    lastMessagePreview: 'hi there',
    lastMessageAt: new Date('2026-01-03T10:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    visitorLastReadAt: null,
    agentLastReadAt: null,
    csatRating: null,
    visitorEmail: null,
    ...extra,
  } as unknown as Conversation
}

beforeEach(() => {
  principalRows = []
  inArrayCalls.length = 0
  vi.clearAllMocks()
})

describe('toMessageDTO', () => {
  it('defaults null attachments to an empty array and ISO-stringifies createdAt', () => {
    const dto = toMessageDTO(makeMessage({ attachments: null }), visitorAuthor)
    expect(dto.attachments).toEqual([])
    expect(dto.createdAt).toBe('2026-01-02T03:04:05.000Z')
    expect(dto.author).toBe(visitorAuthor)
    expect(dto.isInternal).toBe(false)
  })

  it('passes attachments and isInternal through when present', () => {
    const attachments = [
      { url: 'https://x/a.png', name: 'a.png', contentType: 'image/png', size: 10 },
    ]
    const dto = toMessageDTO(
      makeMessage({ attachments, isInternal: true, senderType: 'agent' }),
      visitorAuthor
    )
    expect(dto.attachments).toBe(attachments)
    expect(dto.isInternal).toBe(true)
    expect(dto.senderType).toBe('agent')
  })

  it('carries a note rich doc through as contentJson, defaulting null for plain messages', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] }
    const noteDto = toMessageDTO(
      makeMessage({ isInternal: true, senderType: 'agent', contentJson: doc }),
      visitorAuthor
    )
    expect(noteDto.contentJson).toEqual(doc)
    // A plain visitor/agent message has no rich doc.
    const plainDto = toMessageDTO(makeMessage({ contentJson: null }), visitorAuthor)
    expect(plainDto.contentJson).toBeNull()
  })

  // LEAK GUARD (load-bearing): the shared mapper must NEVER carry the agent-only
  // reaction/flag fields. Those are added exclusively by enrichMessagesForAgent,
  // so every visitor path (which uses toMessageDTO) is clean by construction.
  // If this breaks, agent reactions/flags can leak to the visitor's widget.
  it('never carries the agent-only reactions / flaggedAt fields', () => {
    const dto = toMessageDTO(makeMessage({}), visitorAuthor)
    expect(dto).not.toHaveProperty('reactions')
    expect(dto).not.toHaveProperty('flaggedAt')
  })
})

describe('enrichMessagesForAgent', () => {
  // The agent-only postSuggestion is threaded in-memory (built by listMessages
  // from rows it already loaded). enrichMessagesForAgent must read it straight
  // off the provided map — there is no second metadata SELECT to re-read it.
  it('surfaces postSuggestion from the in-memory map without a second metadata query', async () => {
    const noteId = 'note_1' as ConversationMessageId
    const note = toMessageDTO(
      makeMessage({ id: noteId, isInternal: true, senderType: 'agent' }),
      null
    )
    const suggestion = { boardId: 'board_1', title: 'Dark mode', content: 'wants a night theme' }
    const [enriched] = await enrichMessagesForAgent(
      [note],
      agentId,
      new Map([[noteId, suggestion]])
    )
    expect(enriched.postSuggestion).toEqual(suggestion)
    // Reactions/flags resolve empty against the chain mock; the suggestion rode
    // in on the provided map, so no extra query was issued to attach it.
    expect(enriched.reactions).toEqual([])
    expect(enriched.flaggedAt).toBeNull()
  })

  it('leaves postSuggestion null for messages absent from the map', async () => {
    const plain = toMessageDTO(makeMessage({}), null)
    const [enriched] = await enrichMessagesForAgent([plain], agentId, new Map())
    expect(enriched.postSuggestion).toBeNull()
  })
})

describe('toConversationDTO', () => {
  it('defaults visitorEmail to null when omitted, and null-coalesces csatRating + read watermarks', () => {
    const dto = toConversationDTO(makeConversation(), visitorAuthor, null, 3)
    expect(dto.visitorEmail).toBeNull()
    expect(dto.assignedAgent).toBeNull()
    expect(dto.csatRating).toBeNull()
    expect(dto.visitorLastReadAt).toBeNull()
    expect(dto.agentLastReadAt).toBeNull()
    expect(dto.unreadCount).toBe(3)
    expect(dto.lastMessageAt).toBe('2026-01-03T10:00:00.000Z')
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('passes visitorEmail through when provided', () => {
    const agent: ConversationAuthorDTO = {
      principalId: agentId,
      displayName: 'Ann',
      avatarUrl: null,
    }
    const dto = toConversationDTO(
      makeConversation({ csatRating: 5 }),
      visitorAuthor,
      agent,
      0,
      'visitor@example.com'
    )
    expect(dto.visitorEmail).toBe('visitor@example.com')
    expect(dto.assignedAgent).toBe(agent)
    expect(dto.csatRating).toBe(5)
  })

  it('ISO-stringifies the read watermarks when they are dates', () => {
    const dto = toConversationDTO(
      makeConversation({
        visitorLastReadAt: new Date('2026-02-01T00:00:00.000Z'),
        agentLastReadAt: new Date('2026-02-02T00:00:00.000Z'),
      }),
      visitorAuthor,
      null,
      0
    )
    expect(dto.visitorLastReadAt).toBe('2026-02-01T00:00:00.000Z')
    expect(dto.agentLastReadAt).toBe('2026-02-02T00:00:00.000Z')
  })

  it('defaults translation to null when omitted (visitor-facing calls never pass it)', () => {
    const dto = toConversationDTO(makeConversation(), visitorAuthor, null, 0)
    expect(dto.translation).toBeNull()
  })

  it('passes the translation state through when the caller supplies it (agent-facing)', () => {
    const state = translationStateFrom(
      makeConversation({ translationEnabled: true, detectedCustomerLanguage: 'fr' })
    )
    const dto = toConversationDTO(
      makeConversation(),
      visitorAuthor,
      null,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      state
    )
    expect(dto.translation).toEqual(state)
  })
})

describe('translationStateFrom', () => {
  it('projects the conversation row into the DTO shape', () => {
    const dto = translationStateFrom(
      makeConversation({
        translationEnabled: true,
        detectedCustomerLanguage: 'fr',
        translationDismissedAt: null,
      })
    )
    expect(dto).toEqual({
      enabled: true,
      detectedCustomerLanguage: 'fr',
      suggestionDismissed: false,
    })
  })

  it('reports suggestionDismissed once a dismissal timestamp is set', () => {
    const dto = translationStateFrom(makeConversation({ translationDismissedAt: new Date() }))
    expect(dto.suggestionDismissed).toBe(true)
  })

  it('null-coalesces an undefined translationEnabled / detectedCustomerLanguage', () => {
    // makeConversation casts a partial object, so a row shape from before
    // this migration (missing the new columns) must still degrade cleanly.
    const dto = translationStateFrom({} as Conversation)
    expect(dto).toEqual({
      enabled: false,
      detectedCustomerLanguage: null,
      suggestionDismissed: false,
    })
  })
})

describe('authorFromInput', () => {
  it('null-coalesces missing displayName and avatarUrl', () => {
    expect(authorFromInput({ principalId: visitorId })).toEqual({
      principalId: visitorId,
      displayName: null,
      avatarUrl: null,
    })
  })

  it('passes provided displayName and avatarUrl through', () => {
    expect(
      authorFromInput({ principalId: agentId, displayName: 'Ann', avatarUrl: 'https://x/a.png' })
    ).toEqual({
      principalId: agentId,
      displayName: 'Ann',
      avatarUrl: 'https://x/a.png',
    })
  })
})

describe('fallbackAuthor', () => {
  it('returns a null-identity author for the given principal', () => {
    expect(fallbackAuthor(visitorId)).toEqual({
      principalId: visitorId,
      displayName: null,
      avatarUrl: null,
    })
  })
})

describe('loadAuthors', () => {
  it('returns an empty map without querying when all ids are null/undefined', async () => {
    const map = await loadAuthors([null, undefined])
    expect(map.size).toBe(0)
    expect(inArrayCalls).toHaveLength(0)
  })

  it('dedupes ids and builds a principalId → author map, null-coalescing fields', async () => {
    principalRows = [
      { id: visitorId, displayName: 'Jane', avatarUrl: null },
      { id: agentId, displayName: null, avatarUrl: 'https://x/a.png' },
    ]
    const map = await loadAuthors([visitorId, visitorId, agentId, null])
    // Duplicates + nulls collapsed before the IN query.
    expect(inArrayCalls).toHaveLength(1)
    expect(inArrayCalls[0]).toEqual([visitorId, agentId])
    expect(map.get(visitorId)).toEqual({
      principalId: visitorId,
      displayName: 'Jane',
      avatarUrl: null,
    })
    expect(map.get(agentId)).toEqual({
      principalId: agentId,
      displayName: null,
      avatarUrl: 'https://x/a.png',
    })
  })
})

describe('listConversationsForAgent assignee filter', () => {
  // isNull is used in this builder ONLY for the unassigned-queue filter; the
  // empty result short-circuits before any author load, so a call to isNull
  // unambiguously means the unassigned condition was applied.
  it('adds an "assigned agent IS NULL" condition for the unassigned queue', async () => {
    await listConversationsForAgent({ unassignedOnly: true }, serviceActor)
    expect(isNull).toHaveBeenCalledTimes(1)
  })

  it('does not constrain the assignee by default', async () => {
    await listConversationsForAgent({}, serviceActor)
    expect(isNull).not.toHaveBeenCalled()
  })
})

describe('listConversationsForAgent segment filter', () => {
  const segmentId = 'segment_eng' as SegmentId

  it('restricts to conversations whose visitor is in the requested segments', async () => {
    await listConversationsForAgent({ segmentIds: [segmentId] }, serviceActor)
    // The membership subquery pins conversations to visitors in these segments;
    // the inner inArray carries the requested segment ids.
    expect(inArrayCalls.some((c) => Array.isArray(c) && c.includes(segmentId))).toBe(true)
  })

  it('does not add the segment condition by default', async () => {
    await listConversationsForAgent({}, serviceActor)
    expect(inArrayCalls).toHaveLength(0)
  })

  it('ignores an empty segmentIds array', async () => {
    await listConversationsForAgent({ segmentIds: [] }, serviceActor)
    expect(inArrayCalls).toHaveLength(0)
  })
})

describe('listConversationsForAgent mentions view', () => {
  // The mock's table stubs carry no column props, so eq's first arg is
  // undefined; assert on the principal id flowing into the subquery's WHERE.
  const eqCalledWithPrincipal = () => vi.mocked(eq).mock.calls.some((c) => c[1] === agentId)

  it('restricts to conversations whose notes mention the given principal', async () => {
    const page = await listConversationsForAgent({ mentionedPrincipalId: agentId }, serviceActor)
    expect(page).toEqual({ conversations: [], hasMore: false, nextCursor: null })
    // The mentions subquery pins the mention recipient to this principal.
    expect(eqCalledWithPrincipal()).toBe(true)
  })

  it('does not add the mentions condition by default', async () => {
    await listConversationsForAgent({}, serviceActor)
    expect(eqCalledWithPrincipal()).toBe(false)
  })

  it('excludes soft-deleted notes from the mentions subquery', async () => {
    // Mention rows survive a note's soft-delete (the FK only cascades on hard
    // delete), so the subquery must guard on deleted_at IS NULL or a deleted
    // note keeps the conversation in Mentions forever.
    await listConversationsForAgent({ mentionedPrincipalId: agentId }, serviceActor)
    expect(isNull).toHaveBeenCalled()
  })
})

describe('listConversationsForAgent visitor filter', () => {
  it('restricts to the given visitor', async () => {
    await listConversationsForAgent({ visitorPrincipalId: visitorId }, serviceActor)
    expect(vi.mocked(eq).mock.calls.some((c) => c[1] === visitorId)).toBe(true)
  })

  it('does not constrain by visitor by default', async () => {
    await listConversationsForAgent({}, serviceActor)
    expect(vi.mocked(eq).mock.calls.some((c) => c[1] === visitorId)).toBe(false)
  })
})

describe('listConversationsForAgent company filter', () => {
  const companyId = 'company_acme' as CompanyId

  it('restricts to conversations whose visitor belongs to the company', async () => {
    await listConversationsForAgent({ companyId }, serviceActor)
    // A subquery over principal pins the visitor to this company_id.
    expect(vi.mocked(eq).mock.calls.some((c) => c[1] === companyId)).toBe(true)
  })

  it('does not constrain by company by default', async () => {
    await listConversationsForAgent({}, serviceActor)
    expect(vi.mocked(eq).mock.calls.some((c) => c[1] === companyId)).toBe(false)
  })

  it('combines the company filter with a status filter', async () => {
    await listConversationsForAgent({ companyId, status: 'open' }, serviceActor)
    const calls = vi.mocked(eq).mock.calls
    expect(calls.some((c) => c[1] === companyId)).toBe(true)
    expect(calls.some((c) => c[1] === 'open')).toBe(true)
  })
})

describe('sortDescriptorFor', () => {
  it('maps every sort to its ordering contract', () => {
    expect(sortDescriptorFor('recent')).toEqual({
      primary: 'lastMessageAt',
      direction: 'desc',
    })
    expect(sortDescriptorFor('oldest')).toEqual({
      primary: 'lastMessageAt',
      direction: 'asc',
    })
    expect(sortDescriptorFor('created')).toEqual({
      primary: 'createdAt',
      direction: 'desc',
    })
    expect(sortDescriptorFor('waiting')).toEqual({
      primary: 'waitingSince',
      direction: 'asc',
    })
    expect(sortDescriptorFor('priority')).toEqual({
      primary: 'priorityRank',
      direction: 'desc',
    })
    expect(sortDescriptorFor('sla')).toEqual({
      primary: 'slaDueAt',
      direction: 'asc',
    })
  })

  it('defaults to the recent sort', () => {
    expect(sortDescriptorFor()).toEqual(sortDescriptorFor('recent'))
  })
})

describe('slaDueAtFor / slaDtoFor', () => {
  const stamp = {
    policyId: 'sla_policy_1',
    policyName: 'Gold',
    appliedAt: '2026-01-03T09:00:00.000Z',
    firstResponseDueAt: '2026-01-03T13:00:00.000Z',
    nextResponseTargetSecs: 8 * 3600,
    timeToCloseDueAt: '2026-01-06T09:00:00.000Z',
    firstResponseAt: null,
    pauseOnSnooze: false,
  }

  it('is null without an applied SLA', () => {
    expect(slaDueAtFor(makeConversation())).toBeNull()
    expect(slaDtoFor(makeConversation())).toBeNull()
  })

  it('uses the first-response deadline while that clock is open', () => {
    const c = makeConversation({ slaApplied: stamp } as Partial<Conversation>)
    expect(slaDueAtFor(c)?.toISOString()).toBe('2026-01-03T13:00:00.000Z')
  })

  it('uses the stamped next-response deadline once armed, and drops it once the cycle settles', () => {
    const armed = {
      ...stamp,
      firstResponseAt: '2026-01-03T10:00:00.000Z',
      nextResponseDueAt: '2026-01-03T22:00:00.000Z',
    }
    const c = makeConversation({ slaApplied: armed } as Partial<Conversation>)
    // The armed 22:00 next-response deadline beats the close deadline.
    expect(slaDueAtFor(c)?.toISOString()).toBe('2026-01-03T22:00:00.000Z')
    expect(slaDtoFor(c)?.nextResponseDueAt).toBe('2026-01-03T22:00:00.000Z')

    // Once the teammate answers the cycle, the DTO hides the deadline — the
    // chip stops counting a clock that is already settled.
    const settled = makeConversation({
      slaApplied: { ...armed, nextResponseAt: '2026-01-03T21:00:00.000Z' },
    } as Partial<Conversation>)
    expect(slaDtoFor(settled)?.nextResponseDueAt).toBeNull()
    expect(slaDueAtFor(settled)?.toISOString()).toBe('2026-01-06T09:00:00.000Z')
  })

  it('shows no next-response clock on an old (pre-evaluator) stamp, even with waiting_since set', () => {
    // Absent nextResponseDueAt = unarmed: the wall-clock waiting_since
    // approximation is gone; the next customer message arms the real clock.
    const waiting = new Date('2026-01-03T14:00:00.000Z')
    const settled = { ...stamp, firstResponseAt: '2026-01-03T10:00:00.000Z' }
    const c = makeConversation({
      slaApplied: settled,
      waitingSince: waiting,
    } as Partial<Conversation>)
    expect(slaDtoFor(c)?.nextResponseDueAt).toBeNull()
    expect(slaDueAtFor(c)?.toISOString()).toBe('2026-01-06T09:00:00.000Z')
  })

  it('falls back to the close deadline once replies are settled, and null once resolved', () => {
    const settled = { ...stamp, firstResponseAt: '2026-01-03T10:00:00.000Z' }
    const c = makeConversation({ slaApplied: settled } as Partial<Conversation>)
    expect(slaDueAtFor(c)?.toISOString()).toBe('2026-01-06T09:00:00.000Z')
    const resolved = makeConversation({
      slaApplied: { ...settled, resolvedAt: '2026-01-05T00:00:00.000Z' },
    } as Partial<Conversation>)
    expect(slaDueAtFor(resolved)).toBeNull()
  })

  it('projects the stamp into the DTO, defaulting the pre-field pause rule to true', () => {
    const legacy = { ...stamp, pauseOnSnooze: undefined }
    const dto = slaDtoFor(makeConversation({ slaApplied: legacy } as Partial<Conversation>))
    expect(dto).toMatchObject({
      policyId: 'sla_policy_1',
      policyName: 'Gold',
      firstResponseDueAt: '2026-01-03T13:00:00.000Z',
      nextResponseDueAt: null,
      pauseOnSnooze: true,
    })
  })
})

describe('listConversationsForAgent waiting filter', () => {
  it('adds a "waiting_since IS NOT NULL" condition for the waiting scope', async () => {
    await listConversationsForAgent({ waitingOnly: true }, serviceActor)
    expect(isNotNull).toHaveBeenCalledTimes(1)
  })

  it('does not constrain by waiting by default', async () => {
    await listConversationsForAgent({}, serviceActor)
    expect(isNotNull).not.toHaveBeenCalled()
  })
})

describe('resolveVisitorConversation', () => {
  it('returns the thread for its owner, read-only only when closed', () => {
    const open = makeConversation({ status: 'open' })
    expect(resolveVisitorConversation(open, visitorId)).toEqual({
      conversation: open,
      isReadOnly: false,
    })
    const closed = makeConversation({ status: 'closed' })
    expect(resolveVisitorConversation(closed, visitorId)).toEqual({
      conversation: closed,
      isReadOnly: true,
    })
    const snoozed = makeConversation({ status: 'snoozed' })
    expect(resolveVisitorConversation(snoozed, visitorId)).toEqual({
      conversation: snoozed,
      isReadOnly: false,
    })
  })

  it('hides a thread the visitor does not own', () => {
    const other = makeConversation({ visitorPrincipalId: 'principal_other' as PrincipalId })
    expect(resolveVisitorConversation(other, visitorId)).toEqual({
      conversation: null,
      isReadOnly: false,
    })
  })

  it('returns no conversation for a missing row', () => {
    expect(resolveVisitorConversation(null, visitorId)).toEqual({
      conversation: null,
      isReadOnly: false,
    })
  })
})
