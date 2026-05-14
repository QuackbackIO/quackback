/**
 * `useDebouncedValue` — regression test for the bug that landed in the
 * audit-log filter UI: when this hook was implemented with `useMemo`
 * around `setTimeout`, the cleanup function never ran, so old timers
 * fired and the value would jump backwards as you typed quickly. The
 * useEffect rewrite cancels the pending timer on every value change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedValue } from '../use-debounced-value'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDebouncedValue', () => {
  it('returns the initial value synchronously', () => {
    const { result } = renderHook(() => useDebouncedValue('hello', 300))
    expect(result.current).toBe('hello')
  })

  it('updates to the new value after the delay elapses', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'ab' })
    expect(result.current).toBe('a')

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toBe('ab')
  })

  it('cancels the pending update when the value changes again', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'ab' })
    act(() => {
      vi.advanceTimersByTime(200)
    })

    // Mid-flight change — cancels the first timer.
    rerender({ value: 'abc' })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    // Only 200ms since the LATEST change — still showing the old value.
    expect(result.current).toBe('a')

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe('abc')
  })

  it('cleans up the timer on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { unmount, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    })
    rerender({ value: 'ab' })
    unmount()
    expect(clearSpy).toHaveBeenCalled()
  })
})
