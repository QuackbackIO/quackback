// @vitest-environment happy-dom
/**
 * useStableCallback: one identity across renders, so a memoised child skips
 * them, while every call still runs the handler from the latest render.
 */
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStableCallback } from '../use-stable-callback'

describe('useStableCallback', () => {
  it('keeps its identity and calls the latest handler', () => {
    const { result, rerender } = renderHook(
      ({ label }) => useStableCallback((suffix: string) => `${label}${suffix}`),
      { initialProps: { label: 'first' } }
    )
    const initial = result.current
    expect(initial('!')).toBe('first!')

    rerender({ label: 'second' })

    expect(result.current).toBe(initial)
    expect(initial('!')).toBe('second!')
  })
})
