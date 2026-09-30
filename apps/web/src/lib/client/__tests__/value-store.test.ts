// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { createValueStore, useDebouncedStoreValue, useStoreValue } from '../value-store'

afterEach(() => {
  vi.useRealTimers()
})

describe('createValueStore', () => {
  it('notifies on a change, not on writing the value it holds', () => {
    const store = createValueStore('a')
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.set('a')
    expect(listener).not.toHaveBeenCalled()
    store.set('b')
    expect(store.get()).toBe('b')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    store.set('c')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('useStoreValue', () => {
  it('re-renders only when the selected value changes', () => {
    const store = createValueStore('')
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useStoreValue(store, (value) => value.trim() !== '')
    })
    expect(result.current).toBe(false)

    act(() => store.set('H'))
    expect(result.current).toBe(true)
    const rendersAfterFirst = renders
    act(() => store.set('Hi'))
    expect(renders).toBe(rendersAfterFirst)
  })

  it('returns the whole value without a select', () => {
    const store = createValueStore('x')
    const { result } = renderHook(() => useStoreValue(store))
    act(() => store.set('y'))
    expect(result.current).toBe('y')
  })
})

describe('useDebouncedStoreValue', () => {
  it('hands on the selected value once changes pause', () => {
    vi.useFakeTimers()
    const store = createValueStore({ text: '' })
    const selectText = (value: { text: string }) => value.text
    const { result } = renderHook(() => useDebouncedStoreValue(store, selectText, 500))

    act(() => store.set({ text: 'a' }))
    act(() => vi.advanceTimersByTime(400))
    act(() => store.set({ text: 'ab' }))
    act(() => vi.advanceTimersByTime(400))
    expect(result.current).toBe('')
    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toBe('ab')
  })
})
