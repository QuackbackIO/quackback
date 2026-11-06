// @vitest-environment happy-dom
/**
 * useRemoveStatusSubscriber: the admin Remove action calls the removal fn for
 * the chosen principal, then refreshes the subscriber list and its counts (both
 * live under the subscribers key, so one prefix invalidation covers them).
 */
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const removeFn = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/functions/status', () => ({
  removeStatusSubscriberFn: removeFn,
}))

import { useRemoveStatusSubscriber } from '../status'
import { statusKeys } from '@/lib/client/queries/status'

describe('useRemoveStatusSubscriber', () => {
  it('calls the removal for the principal and refreshes the subscriber list and counts', async () => {
    removeFn.mockResolvedValue({ success: true, removed: true })
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useRemoveStatusSubscriber(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('principal_ada')
    })

    expect(removeFn).toHaveBeenCalledWith({ data: { principalId: 'principal_ada' } })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: statusKeys.subscribers() })
  })
})
