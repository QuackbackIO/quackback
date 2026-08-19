import { describe, it, expect } from 'vitest'
import {
  buildConversationRows,
  derivePendingBlock,
  deriveComposerLock,
  hasCsatBlockMessage,
} from '../conversation-rows'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import type { WorkflowBlockPayload, BlockReplyMetadata } from '@/lib/shared/db-types'

// Only `id` matters for row keys; cast minimal stand-ins.
const msg = (
  idOrOpts: string | (Partial<ConversationMessageDTO> & { id?: string })
): ConversationMessageDTO => {
  if (typeof idOrOpts === 'string') return { id: idOrOpts } as unknown as ConversationMessageDTO
  return { id: 'msg-1', ...idOrOpts } as unknown as ConversationMessageDTO
}

const base = {
  messages: [] as ConversationMessageDTO[],
  hasMoreOlder: false,
  hasGreeting: false,
  showEmpty: false,
  showSeen: false,
  showTyping: false,
  assistantActivity: null,
  assistantStream: '',
  showCsat: false,
}

describe('buildConversationRows', () => {
  it('returns no rows for an empty, flag-less thread', () => {
    expect(buildConversationRows(base)).toEqual([])
  })

  it('keys message rows by message id, in order', () => {
    const rows = buildConversationRows({ ...base, messages: [msg('a'), msg('b'), msg('c')] })
    expect(rows.map((r) => r.key)).toEqual(['a', 'b', 'c'])
    expect(rows.every((r) => r.type === 'message')).toBe(true)
  })

  it('orders load-older, greeting, messages, then trailing seen/typing/csat', () => {
    const rows = buildConversationRows({
      ...base,
      messages: [msg('m1')],
      hasMoreOlder: true,
      hasGreeting: true,
      showSeen: true,
      showTyping: true,
      showCsat: true,
    })
    expect(rows.map((r) => r.key)).toEqual([
      'load-older',
      'greeting',
      'm1',
      'seen',
      'typing',
      'csat',
    ])
  })

  it('shows the working trace, and the stream supersedes it once text arrives', () => {
    const working = buildConversationRows({ ...base, assistantActivity: 'searching_kb' })
    expect(working.map((r) => r.type)).toEqual(['assistant-activity'])

    const streaming = buildConversationRows({
      ...base,
      assistantActivity: 'searching_kb',
      assistantStream: 'Adding the widget…',
    })
    expect(streaming.map((r) => r.type)).toEqual(['assistant-stream'])
  })

  it('routes system messages to system rows (still keyed by id)', () => {
    const sys = {
      id: 's1',
      senderType: 'system',
      content: 'Conversation assigned to Jane',
    } as unknown as ConversationMessageDTO
    const rows = buildConversationRows({ ...base, messages: [msg('a'), sys] })
    expect(rows.map((r) => [r.type, r.key])).toEqual([
      ['message', 'a'],
      ['system', 's1'],
    ])
  })

  it('shows the empty row only when requested (no messages)', () => {
    expect(buildConversationRows({ ...base, showEmpty: true }).map((r) => r.type)).toEqual([
      'empty',
    ])
  })

  it('uses fixed, stable keys for the non-message rows', () => {
    const rows = buildConversationRows({ ...base, hasGreeting: true, showTyping: true })
    expect(rows.map((r) => r.key)).toEqual(['greeting', 'typing'])
  })

  it('routes an embed message (contentJson) to a normal message row', () => {
    const m = msg({
      contentJson: {
        type: 'doc',
        content: [{ type: 'quackbackEmbed', attrs: { kind: 'post', id: 'post_1' } }],
      } as any,
    })
    const rows = buildConversationRows({ ...base, messages: [m] })
    expect(rows.filter((r) => r.type === 'message' && r.key === 'msg-1')).toHaveLength(1)
  })
})

// --- Phase C conversational block layer: state derivation (PHASE-C-BLOCK-
// CONTRACT.md §"Widget state derivation" + amendment 2's widened supersede
// rule) --------------------------------------------------------------------

const buttonsBlock: WorkflowBlockPayload = {
  v: 1,
  runId: 'run_1',
  nodeId: 'node_1',
  waiting: true,
  kind: 'buttons',
  options: [
    { key: 'yes', label: 'Yes' },
    { key: 'no', label: 'No' },
  ],
  allowTyping: false,
}

const csatBlock: WorkflowBlockPayload = {
  v: 1,
  runId: 'run_1',
  nodeId: 'node_2',
  waiting: true,
  kind: 'csat',
  allowTypingInterrupt: true,
  commentPrompt: 'Anything else?',
}

const collectBlock: WorkflowBlockPayload = {
  v: 1,
  runId: 'run_1',
  nodeId: 'node_3',
  waiting: true,
  kind: 'collect',
  attributeKey: 'email',
  fieldType: 'text',
  required: true,
}

const collectReplyBlock: WorkflowBlockPayload = {
  v: 1,
  runId: 'run_1',
  nodeId: 'node_4',
  waiting: true,
  kind: 'collectReply',
  attributeKey: 'issue_description',
}

const messageBlock: WorkflowBlockPayload = {
  v: 1,
  runId: 'run_1',
  nodeId: 'node_5',
  waiting: false,
  kind: 'message',
}

function agentMsg(id: string, over: Partial<ConversationMessageDTO> = {}): ConversationMessageDTO {
  return {
    id,
    senderType: 'agent',
    isAssistant: true,
    content: 'prompt',
    block: null,
    blockReply: null,
    ...over,
  } as unknown as ConversationMessageDTO
}

function visitorMsg(
  id: string,
  over: Partial<ConversationMessageDTO> = {}
): ConversationMessageDTO {
  return {
    id,
    senderType: 'visitor',
    isAssistant: false,
    content: 'reply',
    block: null,
    blockReply: null,
    ...over,
  } as unknown as ConversationMessageDTO
}

function teammateMsg(id: string): ConversationMessageDTO {
  return agentMsg(id, { isAssistant: false })
}

/** The `chat_ended`/`chat_reopened` status-transition system row amendment 3
 *  keys off — conversation.service.ts emits one of these on every close/
 *  reopen (see conversation-rows.ts's BlockState doc). */
function systemMsg(id: string, kind: 'chat_ended' | 'chat_reopened'): ConversationMessageDTO {
  return {
    id,
    senderType: 'system',
    isAssistant: false,
    content: '',
    block: null,
    blockReply: null,
    systemEvent: { kind },
  } as unknown as ConversationMessageDTO
}

function blockStateOf(rows: ReturnType<typeof buildConversationRows>, key: string) {
  const row = rows.find((r) => r.key === key)
  return row && row.type === 'message' ? row.blockState : undefined
}

describe('buildConversationRows — block state derivation', () => {
  it('is pending with no later messages', () => {
    const rows = buildConversationRows({
      ...base,
      messages: [agentMsg('b1', { block: buttonsBlock })],
    })
    expect(blockStateOf(rows, 'b1')).toBe('pending')
  })

  it('is chosen when a later visitor message carries the matching blockReply', () => {
    const reply: BlockReplyMetadata = {
      kind: 'buttons',
      inReplyToMessageId: 'b1',
      buttonKey: 'yes',
    }
    const rows = buildConversationRows({
      ...base,
      messages: [agentMsg('b1', { block: buttonsBlock }), visitorMsg('v1', { blockReply: reply })],
    })
    expect(blockStateOf(rows, 'b1')).toBe('chosen')
  })

  it('is superseded by a later non-matching visitor message', () => {
    const rows = buildConversationRows({
      ...base,
      messages: [agentMsg('b1', { block: buttonsBlock }), visitorMsg('v1')],
    })
    expect(blockStateOf(rows, 'b1')).toBe('superseded')
  })

  it('is superseded by a later visitor message answering a DIFFERENT block', () => {
    const reply: BlockReplyMetadata = {
      kind: 'buttons',
      inReplyToMessageId: 'b2',
      buttonKey: 'yes',
    }
    const rows = buildConversationRows({
      ...base,
      messages: [
        agentMsg('b1', { block: buttonsBlock }),
        agentMsg('b2', { block: buttonsBlock, isAssistant: true }),
        visitorMsg('v1', { blockReply: reply }),
      ],
    })
    expect(blockStateOf(rows, 'b1')).toBe('superseded')
    expect(blockStateOf(rows, 'b2')).toBe('chosen')
  })

  it('is superseded by a later HUMAN teammate message (takeover)', () => {
    const rows = buildConversationRows({
      ...base,
      messages: [agentMsg('b1', { block: buttonsBlock }), teammateMsg('t1')],
    })
    expect(blockStateOf(rows, 'b1')).toBe('superseded')
  })

  it('is NOT superseded by a later ASSISTANT/run message (amendment 2)', () => {
    const rows = buildConversationRows({
      ...base,
      messages: [
        agentMsg('b1', { block: buttonsBlock }),
        agentMsg('a1', { isAssistant: true, block: messageBlock }),
      ],
    })
    expect(blockStateOf(rows, 'b1')).toBe('pending')
  })

  it('is superseded once the conversation is closed', () => {
    const rows = buildConversationRows({
      ...base,
      messages: [agentMsg('b1', { block: buttonsBlock })],
      conversationStatus: 'closed',
    })
    expect(blockStateOf(rows, 'b1')).toBe('superseded')
  })

  it('stays chosen even if the conversation later closes (chosen wins)', () => {
    const reply: BlockReplyMetadata = {
      kind: 'buttons',
      inReplyToMessageId: 'b1',
      buttonKey: 'yes',
    }
    const rows = buildConversationRows({
      ...base,
      messages: [agentMsg('b1', { block: buttonsBlock }), visitorMsg('v1', { blockReply: reply })],
      conversationStatus: 'closed',
    })
    expect(blockStateOf(rows, 'b1')).toBe('chosen')
  })

  it('leaves SEND-kind blocks (message/replyTime) with no state at all', () => {
    const rows = buildConversationRows({
      ...base,
      messages: [agentMsg('m1', { block: messageBlock }), visitorMsg('v1')],
    })
    expect(blockStateOf(rows, 'm1')).toBeUndefined()
  })

  it('leaves an ordinary (non-block) message with no state', () => {
    const rows = buildConversationRows({ ...base, messages: [agentMsg('a1')] })
    expect(blockStateOf(rows, 'a1')).toBeUndefined()
  })

  it('handles collect and collectReply and csat identically to buttons', () => {
    for (const block of [collectBlock, collectReplyBlock, csatBlock]) {
      const rows = buildConversationRows({
        ...base,
        messages: [agentMsg('b1', { block }), teammateMsg('t1')],
      })
      expect(blockStateOf(rows, 'b1')).toBe('superseded')
    }
  })

  // Refresh-ordering: a full reload replays the exact same message list the
  // live SSE-driven state was built from — derivation must be idempotent and
  // order-independent of *when* it's called (not of message order itself,
  // which is always chronological).
  it('reproduces the identical state matrix on a fresh derivation over the same messages (refresh)', () => {
    const reply: BlockReplyMetadata = {
      kind: 'buttons',
      inReplyToMessageId: 'b1',
      buttonKey: 'yes',
    }
    const messages = [
      agentMsg('b1', { block: buttonsBlock }),
      visitorMsg('v1', { blockReply: reply }),
      agentMsg('b2', { block: csatBlock, isAssistant: true }),
    ]
    const first = buildConversationRows({ ...base, messages })
    const second = buildConversationRows({ ...base, messages })
    expect(blockStateOf(first, 'b1')).toBe(blockStateOf(second, 'b1'))
    expect(blockStateOf(first, 'b2')).toBe(blockStateOf(second, 'b2'))
    expect(blockStateOf(second, 'b1')).toBe('chosen')
    expect(blockStateOf(second, 'b2')).toBe('pending')
  })

  // Amendment 3: a block posted AFTER the conversation's last close (e.g. a
  // close-resumes-default workflow's own follow-up CSAT/buttons) must stay
  // tappable — supersede-on-close only reaches blocks that predate the close.
  describe('amendment 3 — post-close blocks stay live', () => {
    it('supersedes a buttons block that predates the close', () => {
      const rows = buildConversationRows({
        ...base,
        messages: [agentMsg('b1', { block: buttonsBlock }), systemMsg('sys1', 'chat_ended')],
        conversationStatus: 'closed',
      })
      expect(blockStateOf(rows, 'b1')).toBe('superseded')
    })

    it('leaves a CSAT block posted AFTER the close pending and tappable', () => {
      const rows = buildConversationRows({
        ...base,
        messages: [systemMsg('sys1', 'chat_ended'), agentMsg('csat1', { block: csatBlock })],
        conversationStatus: 'closed',
      })
      expect(blockStateOf(rows, 'csat1')).toBe('pending')
    })

    it('still supersedes a post-close block once a later visitor/teammate message follows it', () => {
      const rows = buildConversationRows({
        ...base,
        messages: [
          systemMsg('sys1', 'chat_ended'),
          agentMsg('csat1', { block: csatBlock }),
          visitorMsg('v1'),
        ],
        conversationStatus: 'closed',
      })
      expect(blockStateOf(rows, 'csat1')).toBe('superseded')
    })

    it('keys off only the LAST close in a reopen-then-close sequence', () => {
      const rows = buildConversationRows({
        ...base,
        messages: [
          // First cycle: posted, then the conversation closes and reopens —
          // this block now predates the SECOND (last) close too, so it stays
          // superseded rather than reviving.
          agentMsg('b1', { block: buttonsBlock }),
          systemMsg('sys1', 'chat_ended'),
          systemMsg('sys2', 'chat_reopened'),
          visitorMsg('v1'),
          systemMsg('sys3', 'chat_ended'),
          // Second cycle's own follow-up, posted after the LAST close — stays live.
          agentMsg('csat1', { block: csatBlock }),
        ],
        conversationStatus: 'closed',
      })
      expect(blockStateOf(rows, 'b1')).toBe('superseded')
      expect(blockStateOf(rows, 'csat1')).toBe('pending')
    })

    it('falls back to superseding everything when no chat_ended row exists at all (no in-list signal)', () => {
      // No system row — same as pre-amendment-3 behavior: conservatively
      // treat every block as predating the close.
      const rows = buildConversationRows({
        ...base,
        messages: [agentMsg('b1', { block: buttonsBlock })],
        conversationStatus: 'closed',
      })
      expect(blockStateOf(rows, 'b1')).toBe('superseded')
    })
  })
})

describe('derivePendingBlock', () => {
  it('returns null when there is no interactive block at all', () => {
    expect(derivePendingBlock([agentMsg('a1')], null)).toBeNull()
  })

  it('returns the pending block', () => {
    const messages = [agentMsg('b1', { block: buttonsBlock })]
    expect(derivePendingBlock(messages, null)).toEqual({ messageId: 'b1', block: buttonsBlock })
  })

  it('returns null once the block is chosen or superseded', () => {
    const reply: BlockReplyMetadata = {
      kind: 'buttons',
      inReplyToMessageId: 'b1',
      buttonKey: 'yes',
    }
    const chosen = [
      agentMsg('b1', { block: buttonsBlock }),
      visitorMsg('v1', { blockReply: reply }),
    ]
    expect(derivePendingBlock(chosen, null)).toBeNull()

    const superseded = [agentMsg('b1', { block: buttonsBlock }), teammateMsg('t1')]
    expect(derivePendingBlock(superseded, null)).toBeNull()
  })

  it('finds a collectReply block as pending (composer stays the affordance)', () => {
    const messages = [agentMsg('b1', { block: collectReplyBlock })]
    expect(derivePendingBlock(messages, null)).toEqual({
      messageId: 'b1',
      block: collectReplyBlock,
    })
  })
})

describe('deriveComposerLock', () => {
  it('is unlocked with no pending block', () => {
    expect(deriveComposerLock([agentMsg('a1')], null)).toEqual({ disabled: false, lockedBy: null })
  })

  it('locks on a pending buttons block with allowTyping false', () => {
    const messages = [agentMsg('b1', { block: buttonsBlock })]
    expect(deriveComposerLock(messages, null)).toEqual({ disabled: true, lockedBy: 'buttons' })
  })

  it('stays unlocked on a pending buttons block with allowTyping true', () => {
    const messages = [agentMsg('b1', { block: { ...buttonsBlock, allowTyping: true } })]
    expect(deriveComposerLock(messages, null)).toEqual({ disabled: false, lockedBy: null })
  })

  it('locks on a pending csat block with allowTypingInterrupt false', () => {
    const messages = [agentMsg('b1', { block: { ...csatBlock, allowTypingInterrupt: false } })]
    expect(deriveComposerLock(messages, null)).toEqual({ disabled: true, lockedBy: 'csat' })
  })

  it('stays unlocked on a pending csat block with allowTypingInterrupt true', () => {
    const messages = [agentMsg('b1', { block: csatBlock })]
    expect(deriveComposerLock(messages, null)).toEqual({ disabled: false, lockedBy: null })
  })

  it('never locks for collect or collectReply (always typeable per contract)', () => {
    for (const block of [collectBlock, collectReplyBlock]) {
      const messages = [agentMsg('b1', { block })]
      expect(deriveComposerLock(messages, null)).toEqual({ disabled: false, lockedBy: null })
    }
  })

  it('unlocks automatically once the pending block is answered (restored automatically)', () => {
    const reply: BlockReplyMetadata = {
      kind: 'buttons',
      inReplyToMessageId: 'b1',
      buttonKey: 'yes',
    }
    const messages = [
      agentMsg('b1', { block: buttonsBlock }),
      visitorMsg('v1', { blockReply: reply }),
    ]
    expect(deriveComposerLock(messages, null)).toEqual({ disabled: false, lockedBy: null })
  })
})

// CF8: production always passes a precomputed `blockStates`/`precomputedStates`
// map (the render's own useMemo over computeBlockStates); every test above
// exercises only the "derive it fresh" fallback. These prove the OTHER branch
// — the precomputed map wins outright — by handing in a map that says the
// opposite of what a fresh derivation would, so a pass can only mean the
// precomputed value was actually used.
describe('precomputed state maps take precedence over a fresh derivation', () => {
  it('buildConversationRows uses the passed-in blockStates map, not its own derivation', () => {
    const messages = [agentMsg('b1', { block: buttonsBlock })]
    // A fresh derivation of this exact message list would say 'pending' —
    // hand in a map that deliberately disagrees.
    const mismatched = new Map([['b1', 'superseded' as const]])
    const rows = buildConversationRows({ ...base, messages, blockStates: mismatched })
    expect(blockStateOf(rows, 'b1')).toBe('superseded')
  })

  it('derivePendingBlock uses the passed-in precomputedStates map, not its own derivation', () => {
    const messages = [agentMsg('b1', { block: buttonsBlock })]
    // A fresh derivation would return this block as pending — a mismatched
    // map claiming it's already 'chosen' must suppress it.
    const mismatched = new Map([['b1', 'chosen' as const]])
    expect(derivePendingBlock(messages, null, mismatched)).toBeNull()
  })

  it('deriveComposerLock uses the passed-in precomputedStates map, not its own derivation', () => {
    const messages = [agentMsg('b1', { block: buttonsBlock })]
    // A fresh derivation would lock the composer (allowTyping: false) — a
    // mismatched map claiming the block is superseded must leave it unlocked.
    const mismatched = new Map([['b1', 'superseded' as const]])
    expect(deriveComposerLock(messages, null, mismatched)).toEqual({
      disabled: false,
      lockedBy: null,
    })
  })
})

// CF2: visitor-conversation-thread.tsx's legacy end-of-thread CSAT prompt
// must never stack a second ask on top of a workflow's own request_csat
// block, in any of that block's states.
describe('hasCsatBlockMessage', () => {
  it('is false with no messages at all', () => {
    expect(hasCsatBlockMessage([])).toBe(false)
  })

  it('is false when no message carries a csat block', () => {
    expect(hasCsatBlockMessage([agentMsg('a1'), visitorMsg('v1')])).toBe(false)
  })

  it('is false when a DIFFERENT interactive block kind is present (buttons/collect)', () => {
    expect(hasCsatBlockMessage([agentMsg('b1', { block: buttonsBlock })])).toBe(false)
    expect(hasCsatBlockMessage([agentMsg('c1', { block: collectBlock })])).toBe(false)
  })

  it('is true for a pending (unanswered, live) csat block', () => {
    expect(hasCsatBlockMessage([agentMsg('csat1', { block: csatBlock })])).toBe(true)
  })

  it('is true for a chosen (answered) csat block', () => {
    const reply: BlockReplyMetadata = { kind: 'csat', inReplyToMessageId: 'csat1', rating: 5 }
    expect(
      hasCsatBlockMessage([
        agentMsg('csat1', { block: csatBlock }),
        visitorMsg('v1', { blockReply: reply }),
      ])
    ).toBe(true)
  })

  it('is true for a superseded-unanswered csat block (a teammate took over before it was rated)', () => {
    expect(hasCsatBlockMessage([agentMsg('csat1', { block: csatBlock }), teammateMsg('t1')])).toBe(
      true
    )
  })
})
