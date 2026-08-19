/**
 * Pure unit coverage for resolveBlockReply (Phase C, slice C-1): the canonical
 * echo re-derivation per kind, and every degrade-to-plain-text path (invalid,
 * mismatched kind, stale/second). No DB — sendVisitorMessage does the lookups.
 */
import { describe, it, expect } from 'vitest'
import type { ConversationMessageId } from '@quackback/ids'
import { resolveBlockReply, type BlockMessageRef } from '../block-reply'

const blockId = 'conversation_msg_block1' as ConversationMessageId

function buttonsBlock(): BlockMessageRef {
  return {
    id: blockId,
    senderType: 'agent',
    metadata: {
      block: {
        v: 1,
        runId: 'workflow_run_1',
        nodeId: 'n1',
        waiting: true,
        kind: 'buttons',
        options: [
          { key: 'yes', label: 'Yes please' },
          { key: 'no', label: 'No thanks' },
        ],
        allowTyping: false,
      },
    },
  }
}

function collectBlock(fieldType: 'text' | 'number' | 'select' | 'date' = 'text'): BlockMessageRef {
  return {
    id: blockId,
    senderType: 'agent',
    metadata: {
      block: {
        v: 1,
        runId: 'workflow_run_1',
        nodeId: 'n1',
        waiting: true,
        kind: 'collect',
        attributeKey: 'email',
        fieldType,
        required: true,
        ...(fieldType === 'select'
          ? {
              options: [
                { id: 'opt_1', label: 'Billing' },
                { id: 'opt_2', label: 'Technical' },
              ],
            }
          : {}),
      },
    },
  }
}

function collectReplyBlock(): BlockMessageRef {
  return {
    id: blockId,
    senderType: 'agent',
    metadata: {
      block: {
        v: 1,
        runId: 'workflow_run_1',
        nodeId: 'n1',
        waiting: true,
        kind: 'collectReply',
        attributeKey: 'feedback',
      },
    },
  }
}

function csatBlock(): BlockMessageRef {
  return {
    id: blockId,
    senderType: 'agent',
    metadata: {
      block: {
        v: 1,
        runId: 'workflow_run_1',
        nodeId: 'n1',
        waiting: true,
        kind: 'csat',
        allowTypingInterrupt: true,
        commentPrompt: 'Add a comment',
      },
    },
  }
}

describe('resolveBlockReply — buttons', () => {
  it('echoes the matching option label, server-derived (never the client label)', () => {
    const resolved = resolveBlockReply(buttonsBlock(), false, {
      kind: 'buttons',
      inReplyToMessageId: blockId,
      buttonKey: 'no',
    })
    expect(resolved).toEqual({
      content: 'No thanks',
      metadata: { blockReply: { kind: 'buttons', inReplyToMessageId: blockId, buttonKey: 'no' } },
    })
  })

  it('degrades when the buttonKey does not match any declared option', () => {
    expect(
      resolveBlockReply(buttonsBlock(), false, {
        kind: 'buttons',
        inReplyToMessageId: blockId,
        buttonKey: 'maybe',
      })
    ).toBeNull()
  })
})

describe('resolveBlockReply — collect', () => {
  it('echoes a text/number/date value as its string form', () => {
    expect(
      resolveBlockReply(collectBlock('text'), false, {
        kind: 'collect',
        inReplyToMessageId: blockId,
        value: 'jane@example.com',
      })
    ).toEqual({
      content: 'jane@example.com',
      metadata: {
        blockReply: { kind: 'collect', inReplyToMessageId: blockId, value: 'jane@example.com' },
      },
    })

    expect(
      resolveBlockReply(collectBlock('number'), false, {
        kind: 'collect',
        inReplyToMessageId: blockId,
        value: 42,
      })
    ).toMatchObject({ content: '42' })
  })

  it('echoes a select value as its matching option label', () => {
    const resolved = resolveBlockReply(collectBlock('select'), false, {
      kind: 'collect',
      inReplyToMessageId: blockId,
      value: 'opt_2',
    })
    expect(resolved).toMatchObject({ content: 'Technical' })
  })

  it('degrades on an unknown select option or an empty value', () => {
    expect(
      resolveBlockReply(collectBlock('select'), false, {
        kind: 'collect',
        inReplyToMessageId: blockId,
        value: 'opt_bogus',
      })
    ).toBeNull()
    expect(
      resolveBlockReply(collectBlock('text'), false, {
        kind: 'collect',
        inReplyToMessageId: blockId,
        value: '',
      })
    ).toBeNull()
  })
})

describe('resolveBlockReply — collectReply', () => {
  it('echoes the trimmed free-text value verbatim', () => {
    expect(
      resolveBlockReply(collectReplyBlock(), false, {
        kind: 'collectReply',
        inReplyToMessageId: blockId,
        value: '  Loved the new dashboard!  ',
      })
    ).toEqual({
      content: 'Loved the new dashboard!',
      metadata: {
        blockReply: {
          kind: 'collectReply',
          inReplyToMessageId: blockId,
          value: 'Loved the new dashboard!',
        },
      },
    })
  })

  it('degrades on a blank reply', () => {
    expect(
      resolveBlockReply(collectReplyBlock(), false, {
        kind: 'collectReply',
        inReplyToMessageId: blockId,
        value: '   ',
      })
    ).toBeNull()
  })
})

describe('resolveBlockReply — csat', () => {
  it('echoes the matching face + optional comment, low-to-high row', () => {
    expect(
      resolveBlockReply(csatBlock(), false, {
        kind: 'csat',
        inReplyToMessageId: blockId,
        rating: 5,
        comment: 'Fantastic support!',
      })
    ).toEqual({
      content: '😄\nFantastic support!',
      metadata: {
        blockReply: {
          kind: 'csat',
          inReplyToMessageId: blockId,
          rating: 5,
          comment: 'Fantastic support!',
        },
      },
    })

    expect(
      resolveBlockReply(csatBlock(), false, {
        kind: 'csat',
        inReplyToMessageId: blockId,
        rating: 1,
      })
    ).toEqual({
      content: '😞',
      metadata: { blockReply: { kind: 'csat', inReplyToMessageId: blockId, rating: 1 } },
    })
  })

  it('degrades on an out-of-range or non-integer rating', () => {
    expect(
      resolveBlockReply(csatBlock(), false, {
        kind: 'csat',
        inReplyToMessageId: blockId,
        rating: 0,
      })
    ).toBeNull()
    expect(
      resolveBlockReply(csatBlock(), false, {
        kind: 'csat',
        inReplyToMessageId: blockId,
        rating: 6,
      })
    ).toBeNull()
  })
})

describe('resolveBlockReply — degrade to plain text (invalid / stale / second)', () => {
  it('degrades when the referenced message does not exist', () => {
    expect(
      resolveBlockReply(null, false, {
        kind: 'buttons',
        inReplyToMessageId: blockId,
        buttonKey: 'yes',
      })
    ).toBeNull()
  })

  it('degrades when the referenced message is not agent-authored (a visitor/system message id)', () => {
    const notAgent: BlockMessageRef = { ...buttonsBlock(), senderType: 'visitor' }
    expect(
      resolveBlockReply(notAgent, false, {
        kind: 'buttons',
        inReplyToMessageId: blockId,
        buttonKey: 'yes',
      })
    ).toBeNull()
  })

  it('degrades when the referenced message carries no block payload at all (an ordinary agent reply)', () => {
    const ordinary: BlockMessageRef = { id: blockId, senderType: 'agent', metadata: null }
    expect(
      resolveBlockReply(ordinary, false, {
        kind: 'buttons',
        inReplyToMessageId: blockId,
        buttonKey: 'yes',
      })
    ).toBeNull()
  })

  it('degrades when the reply kind does not match the block kind (a csat reply to a buttons block)', () => {
    expect(
      resolveBlockReply(buttonsBlock(), false, {
        kind: 'csat',
        inReplyToMessageId: blockId,
        rating: 5,
      })
    ).toBeNull()
  })

  it('degrades when the block has already been answered (stale / second reply)', () => {
    expect(
      resolveBlockReply(buttonsBlock(), true, {
        kind: 'buttons',
        inReplyToMessageId: blockId,
        buttonKey: 'yes',
      })
    ).toBeNull()
  })
})
