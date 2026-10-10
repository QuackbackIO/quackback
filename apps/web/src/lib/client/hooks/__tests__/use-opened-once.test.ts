// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useOpenedOnce } from '../use-opened-once'

describe('useOpenedOnce', () => {
  it('stays false until the first open, then stays true', () => {
    const { result, rerender } = renderHook(({ open }) => useOpenedOnce(open), {
      initialProps: { open: false },
    })
    expect(result.current).toBe(false)
    rerender({ open: false })
    expect(result.current).toBe(false)
    rerender({ open: true })
    expect(result.current).toBe(true)
    rerender({ open: false })
    expect(result.current).toBe(true)
  })

  it('is true at once when it starts open', () => {
    const { result } = renderHook(() => useOpenedOnce(true))
    expect(result.current).toBe(true)
  })
})
