// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSteadyHandlers } from '../use-steady-handlers'

describe('useSteadyHandlers', () => {
  it('keeps each handler one function, calling the latest given', () => {
    const first = vi.fn()
    const second = vi.fn((n: number) => n * 2)
    const { result, rerender } = renderHook(({ on }) => useSteadyHandlers({ on }), {
      initialProps: { on: first as (n: number) => unknown },
    })
    const kept = result.current
    rerender({ on: second })
    expect(result.current).toBe(kept)
    expect(result.current.on).toBe(kept.on)
    expect(kept.on(3)).toBe(6)
    expect(second).toHaveBeenCalledWith(3)
    expect(first).not.toHaveBeenCalled()
  })
})
