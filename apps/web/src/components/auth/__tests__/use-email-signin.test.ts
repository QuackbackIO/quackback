// @vitest-environment happy-dom
/**
 * The code step's spinner is `emailSignin.loading`, and nothing else clears it.
 *
 * `verify` set it on entry and cleared it only in `catch`, so a SUCCESSFUL
 * verification left it on forever. Inside a dialog that closes on success that
 * was invisible; on a page that stays mounted it is a screen that has signed
 * you in and still says it is working.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const hoisted = vi.hoisted(() => ({ emailOtp: vi.fn() }))
vi.mock('@/lib/client/auth-client', () => ({
  authClient: { signIn: { emailOtp: hoisted.emailOtp } },
}))

import { useEmailSignin } from '../use-email-signin'

beforeEach(() => vi.clearAllMocks())

describe('useEmailSignin.verify', () => {
  it('stops loading once the code is accepted', async () => {
    hoisted.emailOtp.mockResolvedValue({ data: {}, error: null })
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useEmailSignin({ callbackUrl: '/onboarding', onSuccess }))

    await act(async () => {
      await result.current.verify('someone@example.com', '123456')
    })

    expect(onSuccess).toHaveBeenCalledOnce()
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('stops loading and reports the failure when the code is rejected', async () => {
    hoisted.emailOtp.mockResolvedValue({
      data: null,
      error: { message: 'Invalid or expired code' },
    })
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useEmailSignin({ callbackUrl: '/onboarding', onSuccess }))

    await act(async () => {
      await result.current.verify('someone@example.com', '123456')
    })

    expect(onSuccess).not.toHaveBeenCalled()
    expect(result.current.error).toMatch(/invalid or expired/i)
    expect(result.current.loading).toBe(false)
  })

  // The guard that makes a stuck spinner permanent rather than merely wrong:
  // `verify` refuses to run while `loading` is true, so a second attempt after
  // a success that never cleared it does nothing at all.
  it('can verify again after a success', async () => {
    hoisted.emailOtp.mockResolvedValue({ data: {}, error: null })
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useEmailSignin({ callbackUrl: '/onboarding', onSuccess }))

    await act(async () => {
      await result.current.verify('someone@example.com', '123456')
    })
    await act(async () => {
      await result.current.verify('someone@example.com', '123456')
    })

    expect(hoisted.emailOtp).toHaveBeenCalledTimes(2)
  })
})
