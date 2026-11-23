// @vitest-environment happy-dom
/**
 * `useDebouncedSearch`: typing is written out after the delay, and an
 * external reset (Clear all filters) wins over a write that was already
 * scheduled. The second case is a race: a debounce timer can fire after the
 * reset has committed but before React re-renders with the cleared input and
 * cancels it. The test runs such a stale callback by hand.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedSearch } from '../use-debounced-search'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function setup(initial: string | undefined) {
  const onChange = vi.fn()
  const hook = renderHook(
    ({ external }: { external: string | undefined }) =>
      useDebouncedSearch({ externalValue: external, onChange }),
    { initialProps: { external: initial } }
  )
  return { onChange, ...hook }
}

describe('useDebouncedSearch', () => {
  it('writes typed text after the delay, once', () => {
    const { result, onChange } = setup(undefined)
    act(() => result.current.setValue('abc'))
    expect(onChange).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('abc')
  })

  it('follows an external change without writing it back', () => {
    const { result, rerender, onChange } = setup('abc')
    rerender({ external: undefined })
    expect(result.current.value).toBe('')
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a write scheduled before an external reset does not undo the reset', () => {
    const scheduled: Array<() => void> = []
    const realSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      scheduled.push(fn)
      return realSetTimeout(fn, ms)
    }) as typeof setTimeout)

    // Mounted from the URL with a search: the mount schedules a debounce.
    const { result, rerender, onChange } = setup('abc')
    const stale = scheduled.at(-1)!
    // Clear all filters: the URL drops the search and the input follows.
    rerender({ external: undefined })
    expect(result.current.value).toBe('')
    // The timer from before the reset fires late, as it can under load.
    act(() => stale())
    expect(onChange).not.toHaveBeenCalled()
  })
})
