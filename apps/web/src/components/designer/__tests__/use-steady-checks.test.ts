// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { DesignCheck } from '@/lib/shared/design/checks'
import { defaultDesign } from '@/lib/shared/design/schema'
import { useSteadyChecks } from '../use-steady-checks'

const check = (text: string, apply = vi.fn()): DesignCheck => ({
  id: 'small',
  text,
  part: 'site:styles',
  fix: { label: 'Make it bigger', apply },
})

describe('useSteadyChecks', () => {
  it('keeps the list while the checks say the same, and changes it when they do not', () => {
    const { result, rerender } = renderHook(({ checks }) => useSteadyChecks(checks), {
      initialProps: { checks: [check('Some text is under 12px.')] },
    })
    const first = result.current
    rerender({ checks: [check('Some text is under 12px.')] })
    expect(result.current).toBe(first)
    rerender({ checks: [check('Some text is under 10px.')] })
    expect(result.current).not.toBe(first)
    expect(result.current[0]!.text).toBe('Some text is under 10px.')
    rerender({ checks: [] })
    expect(result.current).toEqual([])
  })

  it('makes the fix the latest checks make, from a list kept from before', () => {
    const old = vi.fn()
    const latest = vi.fn()
    const { result, rerender } = renderHook(({ checks }) => useSteadyChecks(checks), {
      initialProps: { checks: [check('Some text is under 12px.', old)] },
    })
    const kept = result.current
    rerender({ checks: [check('Some text is under 12px.', latest)] })
    expect(result.current).toBe(kept)
    const draft = defaultDesign()
    kept[0]!.fix!.apply(draft)
    expect(latest).toHaveBeenCalledWith(draft)
    expect(old).not.toHaveBeenCalled()
  })
})
