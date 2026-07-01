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
const sendAgentMessage = vi.fn()
const addVoteOnBehalf = vi.fn()
const createPost = vi.fn()
// Sentinel embed doc so assertions can match the post id that was embedded.
const postEmbedDoc = vi.fn((...a: unknown[]) => ({
  type: 'doc',
  content: [{ type: 'quackbackEmbed', attrs: { kind: 'post', id: a[0] } }],
}))
const createComment = vi.fn()
const insertedLinks: Record<string, unknown>[] = []
let onConflictHit = false

vi.mock('@/lib/server/policy/chat', () => ({
  canActAsAgent: (actor: Actor) => canActAsAgent(actor),
}))

vi.mock('../conversation.service', () => ({
  assertConversationViewable: (id: ConversationId, actor: Actor) =>
    assertConversationViewable(id, actor),
  sendAgentMessage: (...args: unknown[]) => sendAgentMessage(...args),
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

// Mocked so the dynamic import inside createPostFromConversation is intercepted
// without loading the real module (which carries its own heavy deps).
vi.mock('../conversation.cards', () => ({
  postEmbedDoc: (...args: unknown[]) => postEmbedDoc(...args),
}))

vi.mock('@/lib/server/domains/comments/comment.service', () => ({
  createComment: (...args: unknown[]) => createComment(...args),
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

import { createPostFromConversation } from '../conversation.convert'

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

const agent = {
  principalId: agentPrincipalId,
  displayName: 'Agent Smith',
  avatarUrl: null,
  email: 'agent@example.test',
}

const ctx = { agentActor, agentPrincipalId, agent }

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
  sendAgentMessage.mockResolvedValue(undefined)
  createComment.mockResolvedValue(undefined)
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

  it('records the acting agent as trackedByPrincipalId on the created post', async () => {
    await createPostFromConversation({ conversationId, boardId, title: 'Add dark mode' }, ctx)

    expect(createPost).toHaveBeenCalledTimes(1)
    const [postInput] = createPost.mock.calls[0]
    expect(postInput).toMatchObject({ trackedByPrincipalId: agentPrincipalId })
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

  it('posts a private comment on the upvoted post when sourceMessageContent is provided', async () => {
    const sourceMessageContent = 'I really need this feature for my workflow.'
    await createPostFromConversation(
      { conversationId, boardId, asUpvoteOfPostId: existingPostId, sourceMessageContent },
      ctx
    )

    expect(createComment).toHaveBeenCalledTimes(1)
    const [commentInput, author, actor] = createComment.mock.calls[0]
    expect(commentInput).toMatchObject({
      postId: existingPostId,
      isPrivate: true,
    })
    expect(commentInput.content).toContain(sourceMessageContent)
    expect(author.role).toMatch(/^(admin|member)$/)
    expect(actor).toBe(agentActor)
  })

  it('skips the private comment when sourceMessageContent is absent', async () => {
    await createPostFromConversation(
      { conversationId, boardId, asUpvoteOfPostId: existingPostId },
      ctx
    )
    expect(createComment).not.toHaveBeenCalled()
  })

  it('skips the private comment when sourceMessageContent is whitespace-only', async () => {
    await createPostFromConversation(
      { conversationId, boardId, asUpvoteOfPostId: existingPostId, sourceMessageContent: '   ' },
      ctx
    )
    expect(createComment).not.toHaveBeenCalled()
  })
})

describe('createPostFromConversation confirmation embed', () => {
  const existingPostId = 'post_existing' as PostId

  it('sends a post embed message into the conversation after creating a new post', async () => {
    await createPostFromConversation({ conversationId, boardId, title: 'Add dark mode' }, ctx)

    expect(postEmbedDoc).toHaveBeenCalledWith('post_new')
    expect(sendAgentMessage).toHaveBeenCalledTimes(1)
    // sendAgentMessage(conversationId, '', agent, agentActor, undefined, embedDoc)
    const [cidArg, contentArg, agentArg, actorArg, attachmentsArg, docArg] =
      sendAgentMessage.mock.calls[0]
    expect(cidArg).toBe(conversationId)
    expect(contentArg).toBe('')
    expect(agentArg).toBe(agent)
    expect(actorArg).toBe(agentActor)
    expect(attachmentsArg).toBeUndefined()
    expect(docArg.content[0]).toMatchObject({ type: 'quackbackEmbed', attrs: { id: 'post_new' } })
  })

  it('sends a post embed message into the conversation after upvoting an existing post', async () => {
    await createPostFromConversation(
      { conversationId, boardId, asUpvoteOfPostId: existingPostId },
      ctx
    )

    expect(postEmbedDoc).toHaveBeenCalledWith(existingPostId)
    expect(sendAgentMessage).toHaveBeenCalledTimes(1)
    const [cidArg, contentArg, , , , docArg] = sendAgentMessage.mock.calls[0]
    expect(cidArg).toBe(conversationId)
    expect(contentArg).toBe('')
    expect(docArg.content[0]).toMatchObject({
      type: 'quackbackEmbed',
      attrs: { id: existingPostId },
    })
  })
})
