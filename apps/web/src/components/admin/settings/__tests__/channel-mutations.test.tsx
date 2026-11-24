// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const ack = vi.fn().mockResolvedValue({})
vi.mock('@/lib/server/functions/settings', () => ({
  updateEmailAutoAckFn: (...a: unknown[]) => ack(...a),
}))

const { useUpdateEmailAutoAck } = await import('@/lib/client/mutations/channel-settings')

function setup<T>(hook: () => T) {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(hook, { wrapper }) }
}

describe('channel settings mutations', () => {
  it('auto-acknowledgement autosaves', async () => {
    const { result, client } = setup(useUpdateEmailAutoAck)
    await act(() => result.current.mutateAsync(false))
    expect(ack).toHaveBeenCalledWith({ data: { enabled: false } })
    expect(client.getMutationCache().getAll()[0].meta).toEqual({ autosave: true })
  })
})
