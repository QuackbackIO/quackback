// @vitest-environment happy-dom
/**
 * The convert-to-post dialog is mounted, closed, beside every open
 * conversation. Its board picker loads the boards when the dialog opens,
 * not while it sits closed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ConversationId } from '@quackback/ids'

afterEach(cleanup)

const fetchBoardsFn = vi.fn()
vi.mock('@/lib/server/functions/boards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/boards')>()),
  fetchBoardsFn: (...args: unknown[]) => fetchBoardsFn(...args),
}))
vi.mock('@/lib/server/functions/public-posts', () => ({ findSimilarPostsFn: vi.fn() }))

const { ConvertToPostDialog } = await import('../convert-to-post-dialog')

const CONVERSATION = 'conversation_01h00000000000000000000000' as ConversationId
const BOARD = {
  id: 'board_01h00000000000000000000000',
  name: 'Ideas',
  slug: 'ideas',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

function dialog(client: QueryClient, open: boolean) {
  return (
    <QueryClientProvider client={client}>
      <ConvertToPostDialog
        conversationId={CONVERSATION}
        defaultTitle="Dark mode"
        defaultContent="Please add dark mode"
        open={open}
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>
  )
}

describe('ConvertToPostDialog', () => {
  it('loads the boards when it opens, not while it is closed', async () => {
    fetchBoardsFn.mockResolvedValue([BOARD])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(dialog(client, false))

    await new Promise((r) => setTimeout(r, 20))
    expect(fetchBoardsFn).not.toHaveBeenCalled()

    rerender(dialog(client, true))

    await waitFor(() => expect(fetchBoardsFn).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Ideas')).toBeInTheDocument()
  })
})
