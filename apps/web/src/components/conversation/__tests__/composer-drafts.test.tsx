// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { TiptapContent } from '@/lib/shared/db-types'
import {
  createComposerDrafts,
  isEmptyDraft,
  useComposerDraftValue,
  useDebouncedDraftText,
} from '../composer-drafts'
import type { ComposerMode } from '../composer-ai-actions'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const draft = (text: string) => ({
  json: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  } as TiptapContent,
  markdown: text,
})

describe('composer drafts', () => {
  it('re-renders a subscriber only when its selected value changes', () => {
    const drafts = createComposerDrafts()
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useComposerDraftValue(drafts, 'reply', isEmptyDraft)
    })
    expect(result.current).toBe(true)

    act(() => drafts.set('reply', draft('H')))
    expect(result.current).toBe(false)
    const afterFirst = renders

    act(() => drafts.set('reply', draft('He')))
    act(() => drafts.set('reply', (prev) => draft(`${prev.markdown}llo`)))
    act(() => drafts.set('note', draft('A note')))
    expect(renders).toBe(afterFirst)
    expect(drafts.get('reply').markdown).toBe('Hello')
  })

  it('hands on a draft text once changes pause, following the mode', () => {
    vi.useFakeTimers()
    const drafts = createComposerDrafts()
    const { result, rerender } = renderHook(
      ({ mode }: { mode: ComposerMode }) => useDebouncedDraftText(drafts, mode, 500),
      { initialProps: { mode: 'reply' } }
    )

    act(() => drafts.set('reply', draft('https://example.com')))
    act(() => vi.advanceTimersByTime(400))
    act(() => drafts.set('reply', draft('https://example.com/a')))
    act(() => vi.advanceTimersByTime(400))
    expect(result.current).toBe('')
    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toBe('https://example.com/a')

    act(() => drafts.set('note', draft('https://example.org')))
    rerender({ mode: 'note' })
    act(() => vi.advanceTimersByTime(500))
    expect(result.current).toBe('https://example.org')
  })
})
