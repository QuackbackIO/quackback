// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const router = vi.hoisted(() => ({ invalidate: vi.fn(async () => {}) }))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => router }))

beforeEach(() => {
  vi.resetModules()
  router.invalidate.mockClear()
})

async function load() {
  const frame = await import('@/lib/client/widget-frame')
  const { useReseedOnPortalRefusal } = await import('../use-reseed-on-portal-refusal')
  return { frame, useReseedOnPortalRefusal }
}

describe('useReseedOnPortalRefusal', () => {
  it('re-runs the loaders once when the frame refused a session the server offered', async () => {
    const { frame, useReseedOnPortalRefusal } = await load()
    frame.setFrameHoldsPortalSession(false)
    const { rerender } = renderHook(({ token }) => useReseedOnPortalRefusal(token), {
      initialProps: { token: 'server-token' as string | null },
    })
    expect(router.invalidate).toHaveBeenCalledTimes(1)

    // The re-run offers no session; a later offer on the same mount is not
    // followed by another re-run either.
    rerender({ token: null })
    rerender({ token: 'server-token' })
    expect(router.invalidate).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the frame holds the session', async () => {
    const { frame, useReseedOnPortalRefusal } = await load()
    frame.setFrameHoldsPortalSession(true)
    renderHook(() => useReseedOnPortalRefusal('server-token'))
    expect(router.invalidate).not.toHaveBeenCalled()
  })

  it('does nothing when the server offered no session', async () => {
    const { frame, useReseedOnPortalRefusal } = await load()
    frame.setFrameHoldsPortalSession(false)
    renderHook(() => useReseedOnPortalRefusal(null))
    expect(router.invalidate).not.toHaveBeenCalled()
  })
})
