// @vitest-environment happy-dom
/**
 * The thread request seeds the block-status query the person controls read
 * through their own hook. Pins that the hook reads the seeded entry, so a
 * visitor's block state costs no request of its own when a conversation opens.
 */
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ConversationId, PrincipalId } from '@quackback/ids'

const getPersonBlockStatusFn = vi.fn()
vi.mock('@/lib/server/functions/blocking', () => ({
  getPersonBlockStatusFn: (...args: unknown[]) => getPersonBlockStatusFn(...args),
  blockPersonFn: vi.fn(),
  unblockPersonFn: vi.fn(),
}))

const { seedConversationPanels } = await import('@/lib/client/queries/conversation-panel-cache')
const { usePersonBlockStatus } = await import('@/components/admin/users/block-person-control')

const CONVERSATION = 'conversation_01h00000000000000000000000' as ConversationId
const VISITOR = 'principal_01h00000000000000000000000' as PrincipalId

describe('seeded block status', () => {
  it("is what the person controls' hook reads, with no request of its own", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    seedConversationPanels(client, CONVERSATION, VISITOR, {
      blockStatus: { blockedAt: '2026-07-01T00:00:00.000Z' },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => usePersonBlockStatus(VISITOR), { wrapper })

    await waitFor(() => expect(result.current.blocked).toBe(true))
    expect(getPersonBlockStatusFn).not.toHaveBeenCalled()
  })
})
