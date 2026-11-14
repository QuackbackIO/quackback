/**
 * A conversation the server answers NotFound for (deleted, or outside the
 * viewer's scope) is read once and never retried, so the inbox shows the
 * "Conversation not found" pane at once instead of a skeleton through the
 * retries. Any other failure keeps the default retries.
 *
 * The errors stand in for what the browser receives: a typed server error
 * arrives as an Error carrying its own `code` and `statusCode`, and loses its
 * class name on the way.
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId } from '@quackback/ids'

const mockGetConversation = vi.fn()
vi.mock('@/lib/server/functions/conversation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/conversation')>()),
  getConversationFn: (...args: unknown[]) => mockGetConversation(...args),
}))

const { conversationInboxQueries } = await import('../conversation-inbox')

const CONVERSATION = 'conversation_01h00000000000000000000000' as ConversationId

/** The retries a `useQuery` gets by default, with no wait between tries. */
function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } })
}

beforeEach(() => {
  mockGetConversation.mockReset()
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }))
})

describe('conversationInboxQueries.thread', () => {
  it('reads a NotFound conversation once and does not retry', async () => {
    mockGetConversation.mockRejectedValue(
      Object.assign(new Error('Conversation not found'), {
        code: 'CONVERSATION_NOT_FOUND',
        statusCode: 404,
      })
    )
    await expect(
      client().fetchQuery(conversationInboxQueries.thread(CONVERSATION))
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(mockGetConversation).toHaveBeenCalledTimes(1)
  })

  it('still retries any other failure', async () => {
    mockGetConversation.mockRejectedValue(
      Object.assign(new Error('Something went wrong on our side.'), { reference: 'ABCD-1234' })
    )
    await expect(
      client().fetchQuery(conversationInboxQueries.thread(CONVERSATION))
    ).rejects.toThrow()
    expect(mockGetConversation).toHaveBeenCalledTimes(4)
  })
})
