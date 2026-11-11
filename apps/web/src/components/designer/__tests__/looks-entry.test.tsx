// @vitest-environment happy-dom
/**
 * The ways into Compare looks: open from anywhere, counted by where from;
 * a brand match kept as the base of its looks while it is the draft's
 * latest; and the first match handed over from onboarding opening it once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { DesignAiTurn } from '@/components/admin/settings/appearance/use-design-ai'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { installInMemoryLocalStorage } from '@/test/local-storage'

const events = vi.hoisted(() => ({ trackBuilder: vi.fn() }))
vi.mock('@/lib/client/builder-events', () => events)

installInMemoryLocalStorage()

const entry = await import('../looks-entry')

const matched = (at = '2026-11-01T00:00:00.000Z') => {
  const design = defaultDesign()
  design.brand.matchedAt = at
  return design
}
const matchReply: DesignAiTurn = {
  role: 'assistant',
  text: 'Matched.',
  matched: true,
  changes: [{ path: 'layout.hero', before: 'none', after: 'brand' }],
}

beforeEach(() => {
  localStorage.clear()
  entry.closeLooks()
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('open and close', () => {
  it('opens once, counted by where from, until closed', () => {
    const { result } = renderHook(() => entry.useLooksOpen())
    expect(result.current).toBeNull()
    act(() => entry.openLooks('theme'))
    expect(result.current).toBe('theme')
    // Already open: another way in changes nothing.
    act(() => entry.openLooks('ai'))
    expect(result.current).toBe('theme')
    expect(events.trackBuilder).toHaveBeenCalledTimes(1)
    expect(events.trackBuilder).toHaveBeenCalledWith('designer_looks_opened', { from: 'theme' })
    act(() => entry.closeLooks())
    expect(result.current).toBeNull()
  })
})

describe('the base of the looks', () => {
  it('is the match kept while it is the draft’s latest match, else the draft', () => {
    const match = matched()
    entry.rememberMatch(match)
    const edited = structuredClone(match)
    edited.shape.corners = 'sharp'
    expect(entry.lookBase(edited)).toEqual(match)
    // A newer match, made in another browser, is not the one kept.
    const newer = matched('2026-11-05T00:00:00.000Z')
    expect(entry.lookBase(newer)).toBe(newer)
    // Never matched: the draft.
    const plain = defaultDesign()
    expect(entry.lookBase(plain)).toBe(plain)
  })

  it('names the look taken while the draft still has it', () => {
    const design = matched()
    entry.rememberMatch(design)
    expect(entry.appliedLookName(design)).toBe('Matched')
    const soft = structuredClone(design)
    soft.layout.hero = 'tint'
    entry.rememberApplied('soft', soft)
    expect(entry.appliedLookName(soft)).toBe('Soft')
    expect(entry.appliedLookName(design)).toBeNull()
  })
})

describe('useLooksAfterMatch', () => {
  function run(turns: DesignAiTurn[], design: PortalDesign, onboarding: boolean) {
    const hook = renderHook(
      ({ busy, turns: said }) => entry.useLooksAfterMatch(busy, said, design),
      {
        initialProps: { busy: false, turns: [] as DesignAiTurn[] },
      }
    )
    if (onboarding) hook.result.current.fromOnboarding()
    hook.rerender({ busy: true, turns: [] })
    hook.rerender({ busy: false, turns })
    return hook
  }

  it('opens by itself after onboarding’s first match, once, and keeps the match', () => {
    const design = matched()
    const open = renderHook(() => entry.useLooksOpen())
    run([matchReply], design, true)
    expect(open.result.current).toBe('onboarding')
    expect(entry.lookBase(structuredClone(design))).toEqual(design)
    act(() => entry.closeLooks())
    // A later match handed over from onboarding only offers it.
    run([matchReply], matched('2026-11-02T00:00:00.000Z'), true)
    expect(open.result.current).toBeNull()
  })

  it('does not open after a match started in the builder, nor after a request that was no match', () => {
    const open = renderHook(() => entry.useLooksOpen())
    run([matchReply], matched(), false)
    expect(open.result.current).toBeNull()
    run([{ role: 'assistant', text: 'Done.', changes: [] }], matched(), true)
    expect(open.result.current).toBeNull()
  })
})
