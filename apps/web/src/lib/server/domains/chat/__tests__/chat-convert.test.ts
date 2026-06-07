/**
 * createPostFromConversation — turning a live-chat conversation into feedback.
 * Covers the agent authorization guard, the not-found conversation chokepoint,
 * the create-new-post path (seeded from the transcript + visitor attribution),
 * the upvote-existing path (records a vote, no post created), the title
 * requirement on the create path, and the durable conversation->post link.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId, PostId, BoardId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'

// Module-level handles so we can assert calls + drive return values per test.
const canActAsAgent = vi.fn()
const assertConversationViewable = vi.fn()
const addVoteOnBehalf = vi.fn()
const createPost = vi.fn()
const insertedLinks: Record<string, unknown>[] = []
let onConflictHit = false

vi.mock('@/lib/server/policy/chat', () => ({
  canActAsAgent: (actor: Actor) => canActAsAgent(actor),
}))

vi.mock('../chat.service', () => ({
  assertConversationViewable: (id: ConversationId, actor: Actor) =>
    assertConversationViewable(id, actor),
}))

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'http://localhost:3000/' },
}))

// Dynamically imported inside the function under test.
vi.mock('@/lib/server/domains/posts/post.voting', () => ({
  addVoteOnBehalf: (...args: unknown[]) => addVoteOnBehalf(...args),
}))
vi.mock('@/lib/server/domains/posts/post.service', () => ({
  createPost: (...args: unknown[]) => createPost(...args),
}))

vi.mock('@/lib/server/db', () => {
  function insertChain() {
    const c: Record<string, unknown> = {}
    c.values = (row: Record<string, unknown>) => {
      insertedLinks.push(row)
      return c
    }
    c.onConflictDoNothing = async () => {
      onConflictHit = true
      return []
    }
    return c
  }
  return {
    db: { insert: () => insertChain() },
    postExternalLinks: { __name: 'post_external_links' },
  }
})

import { createPostFromConversation } from '../chat.convert'

const conversationId = 'conversation_1' as ConversationId
const boardId = 'board_1' as BoardId
const visitorPrincipalId = 'principal_visitor' as PrincipalId
const agentPrincipalId = 'principal_agent' as PrincipalId

const agentActor: Actor = {
  principalId: agentPrincipalId,
  role: 'member',
  principalType: 'user',
  segmentIds: new Set(),
}

const ctx = { agentActor, agentPrincipalId }

function freshConversation(extra: Record<string, unknown> = {}) {
  return {
    id: conversationId,
    visitorPrincipalId,
    subject: 'Need dark mode',
    ...extra,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  insertedLinks.length = 0
  onConflictHit = false
  // Sensible defaults; individual tests override as needed.
  canActAsAgent.mockReturnValue({ allowed: true })
  assertConversationViewable.mockResolvedValue(freshConversation())
  createPost.mockResolvedValue({ id: 'post_new' as PostId, boardSlug: 'feature-requests' })
  addVoteOnBehalf.mockResolvedValue(undefined)
})

describe('createPostFromConversation authorization guard', () => {
  it('rejects a non-agent actor with ForbiddenError and never touches the conversation', async () => {
    canActAsAgent.mockReturnValue({
      allowed: false,
      reason: 'Only team members can act as a support agent',
    })

    await expect(
      createPostFromConversation({ conversationId, boardId, title: 'x' }, ctx)
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(assertConversationViewable).not.toHaveBeenCalled()
    expect(createPost).not.toHaveBeenCalled()
    expect(addVoteOnBehalf).not.toHaveBeenCalled()
  })

  it('surfaces the policy reason on the ForbiddenError', async () => {
    canActAsAgent.mockReturnValue({ allowed: false, reason: 'nope' })
    await expect(
      createPostFromConversation({ conversationId, boardId, title: 'x' }, ctx)
    ).rejects.toThrow('nope')
  })
})

describe('createPostFromConversation conversation resolution', () => {
  it('propagates a not-found conversation from the access chokepoint', async () => {
    assertConversationViewable.mockRejectedValue(new Error('Conversation not found'))

    await expect(
      createPostFromConversation({ conversationId, boardId, title: 'x' }, ctx)
    ).rejects.toThrow('Conversation not found')

    expect(createPost).not.toHaveBeenCalled()
    expect(insertedLinks).toHaveLength(0)
  })
})

describe('createPostFromConversation create-new path', () => {
  it('requires a title, throwing ValidationError when absent', async () => {
    await expect(
      createPostFromConversation({ conversationId, boardId }, ctx)
    ).rejects.toBeInstanceOf(ValidationError)
    expect(createPost).not.toHaveBeenCalled()
  })

  it('treats a whitespace-only title as missing', async () => {
    await expect(
      createPostFromConversation({ conversationId, boardId, title: '   ' }, ctx)
    ).rejects.toBeInstanceOf(ValidationError)
    expect(createPost).not.toHaveBeenCalled()
  })

  it('creates a post attributed to the visitor, seeded with the live_chat source metadata', async () => {
    const result = await createPostFromConversation(
      { conversationId, boardId, title: '  Add dark mode  ', content: 'from the transcript' },
      ctx
    )

    expect(createPost).toHaveBeenCalledTimes(1)
    const [postInput, postCtx] = createPost.mock.calls[0]
    expect(postInput).toMatchObject({
      boardId,
      title: 'Add dark mode', // trimmed
      content: 'from the transcript',
      widgetMetadata: { source: 'live_chat', conversationId },
    })
    // Attribution: author is the VISITOR, but the agent actor satisfies moderation.
    expect(postCtx).toEqual({ principalId: visitorPrincipalId, actor: agentActor })

    expect(addVoteOnBehalf).not.toHaveBeenCalled()
    expect(result).toEqual({
      postId: 'post_new',
      created: true,
      boardSlug: 'feature-requests',
    })
  })

  it('links the new post back to the conversation via post_external_links (idempotent)', async () => {
    await createPostFromConversation({ conversationId, boardId, title: 'Add dark mode' }, ctx)

    expect(insertedLinks).toHaveLength(1)
    expect(insertedLinks[0]).toMatchObject({
      postId: 'post_new',
      integrationType: 'live_chat',
      externalId: conversationId,
      externalUrl: `http://localhost:3000/admin/inbox?c=${conversationId}`,
      externalDisplayId: 'Need dark mode', // conversation.subject
    })
    expect(onConflictHit).toBe(true)
  })

  it('records a null externalDisplayId when the conversation has no subject', async () => {
    assertConversationViewable.mockResolvedValue(freshConversation({ subject: undefined }))
    await createPostFromConversation({ conversationId, boardId, title: 'Add dark mode' }, ctx)
    expect(insertedLinks[0].externalDisplayId).toBeNull()
  })
})

describe('createPostFromConversation upvote-existing path', () => {
  const existingPostId = 'post_existing' as PostId

  it('records a vote on behalf of the visitor instead of creating a post', async () => {
    const result = await createPostFromConversation(
      { conversationId, boardId, asUpvoteOfPostId: existingPostId },
      ctx
    )

    expect(createPost).not.toHaveBeenCalled()
    expect(addVoteOnBehalf).toHaveBeenCalledTimes(1)
    const [postIdArg, principalArg, sourceArg, fourthArg, agentArg] = addVoteOnBehalf.mock.calls[0]
    expect(postIdArg).toBe(existingPostId)
    expect(principalArg).toBe(visitorPrincipalId)
    expect(sourceArg).toMatchObject({
      type: 'live_chat',
      externalUrl: `http://localhost:3000/admin/inbox?c=${conversationId}`,
    })
    expect(fourthArg).toBeNull()
    expect(agentArg).toBe(agentPrincipalId)

    expect(result).toEqual({
      postId: existingPostId,
      created: false,
      boardSlug: null,
    })
  })

  it('still links the existing post to the conversation, ignoring any title', async () => {
    await createPostFromConversation(
      { conversationId, boardId, asUpvoteOfPostId: existingPostId, title: 'ignored' },
      ctx
    )
    expect(insertedLinks).toHaveLength(1)
    expect(insertedLinks[0]).toMatchObject({
      postId: existingPostId,
      integrationType: 'live_chat',
      externalId: conversationId,
    })
  })
})
