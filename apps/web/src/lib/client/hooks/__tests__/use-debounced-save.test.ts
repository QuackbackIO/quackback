// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedSave } from '../use-debounced-save'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useDebouncedSave', () => {
  it('saves the newest queued value after the delay', () => {
    const save = vi.fn()
    const { result } = renderHook(() => useDebouncedSave<string>(save, 400))
    act(() => {
      result.current.queue('a')
      result.current.queue('b')
    })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('b')
  })

  it('cancel drops the queued value, including on unmount', () => {
    const save = vi.fn()
    const { result, unmount } = renderHook(() => useDebouncedSave<string>(save, 400))
    act(() => {
      result.current.queue('a')
      result.current.cancel()
    })
    expect(result.current.hasPending()).toBe(false)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    unmount()
    expect(save).not.toHaveBeenCalled()
  })
})
