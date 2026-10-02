// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const fns = vi.hoisted(() => ({
  updateDomain: vi.fn(),
  verifyDomain: vi.fn(),
}))

vi.mock('@/lib/server/functions/help-center-domain', () => ({
  updateHelpCenterDomainFn: fns.updateDomain,
  verifyHelpCenterDomainFn: fns.verifyDomain,
  getHelpCenterDomainStatusFn: vi.fn(),
}))

const { useUpdateHelpCenterDomain, useVerifyHelpCenterDomain } = await import('../settings')

function deferred() {
  let resolve!: (value: unknown) => void
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Help Center config mutations run one after another', () => {
  it('starts verify only after the domain update has settled', async () => {
    const update = deferred()
    fns.updateDomain.mockReturnValue(update.promise)
    fns.verifyDomain.mockResolvedValue({})
    const client = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => ({ update: useUpdateHelpCenterDomain(), verify: useVerifyHelpCenterDomain() }),
      { wrapper }
    )

    act(() => {
      result.current.update.mutate('new.acme.com')
      result.current.verify.mutate()
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(fns.updateDomain).toHaveBeenCalledTimes(1)
    expect(fns.verifyDomain).not.toHaveBeenCalled()

    await act(async () => {
      update.resolve({})
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(fns.verifyDomain).toHaveBeenCalledTimes(1)
  })
})
