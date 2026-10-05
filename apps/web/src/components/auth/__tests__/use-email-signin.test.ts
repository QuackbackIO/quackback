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

import { createElement, type ReactNode } from 'react'
import { IntlProvider } from 'react-intl'
import { useEmailSignin } from '../use-email-signin'

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(IntlProvider, { locale: 'en' }, children)

beforeEach(() => vi.clearAllMocks())

describe('useEmailSignin.verify', () => {
  it('stops loading once the code is accepted', async () => {
    hoisted.emailOtp.mockResolvedValue({ data: {}, error: null })
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useEmailSignin({ callbackUrl: '/onboarding', onSuccess }), {
      wrapper,
    })

    await act(async () => {
      await result.current.verify('someone@example.com', '123456')
    })

    expect(onSuccess).toHaveBeenCalledOnce()
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('stops loading and reports the failure when the code is rejected', async () => {
    hoisted.emailOtp.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_OTP', message: 'Invalid OTP' },
    })
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useEmailSignin({ callbackUrl: '/onboarding', onSuccess }), {
      wrapper,
    })

    await act(async () => {
      await result.current.verify('someone@example.com', '123456')
    })

    expect(onSuccess).not.toHaveBeenCalled()
    expect(result.current.error).toBe(
      "That code isn't right. Check the email and try again, or send a new code."
    )
    expect(result.current.loading).toBe(false)
  })

  // The guard that makes a stuck spinner permanent rather than merely wrong:
  // `verify` refuses to run while `loading` is true, so a second attempt after
  // a success that never cleared it does nothing at all.
  it('can verify again after a success', async () => {
    hoisted.emailOtp.mockResolvedValue({ data: {}, error: null })
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useEmailSignin({ callbackUrl: '/onboarding', onSuccess }), {
      wrapper,
    })

    await act(async () => {
      await result.current.verify('someone@example.com', '123456')
    })
    await act(async () => {
      await result.current.verify('someone@example.com', '123456')
    })

    expect(hoisted.emailOtp).toHaveBeenCalledTimes(2)
  })
})

describe('useEmailSignin.verify wording', () => {
  it.each([
    ['OTP_EXPIRED', 'That code expired. Send a new one.'],
    ['TOO_MANY_ATTEMPTS', 'Too many tries. Send a new code.'],
  ])('says what went wrong for %s, never the raw error', async (code, copy) => {
    hoisted.emailOtp.mockResolvedValue({ data: null, error: { code, message: 'raw' } })
    const { result } = renderHook(
      () => useEmailSignin({ callbackUrl: '/onboarding', onSuccess: vi.fn() }),
      { wrapper }
    )
    await act(async () => {
      await result.current.verify('someone@example.com', '123456')
    })
    expect(result.current.error).toBe(copy)
  })
})
