// @vitest-environment happy-dom
/**
 * Preview follows the visitor: leaving it keeps the builder on the page
 * reached, says so quietly with the way back, and counts each page reached.
 * The item picker offers the posts it was given, and a sample says so.
 */
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import type { PostHog } from 'posthog-js'
import { setAnalyticsClient } from '@/lib/client/analytics'
import type { CanvasLocation, DesignerPage } from '@/lib/shared/design/outline'
import type { SamplePage } from '@/lib/shared/design/sample-pages'
import { usePreviewFollow } from '../use-preview-follow'
import { CanvasBar } from '../canvas-bar'

const capture = vi.fn()
beforeEach(() => {
  capture.mockReset()
  setAnalyticsClient({ capture } as unknown as PostHog)
})
afterEach(() => {
  cleanup()
  setAnalyticsClient(null)
})

const PAGES: DesignerPage[] = ['feedback', 'post', 'roadmap', 'changelog']

function follow(start: CanvasLocation = { page: 'feedback', item: null }) {
  return renderHook(
    ({ previewing }: { previewing: boolean }) => {
      const [here, setHere] = useState(start)
      const setPage = (page: DesignerPage, item?: string | null) =>
        setHere({ page, item: item ?? null })
      return {
        here,
        ...usePreviewFollow({ previewing, here, pages: PAGES, homeOn: false, setPage }),
      }
    },
    { initialProps: { previewing: false } }
  )
}

describe('usePreviewFollow', () => {
  it('keeps the builder on the page Preview reached, with the way back', () => {
    const view = follow()
    view.rerender({ previewing: true })
    act(() => view.result.current.onLocation('/roadmap'))
    act(() => view.result.current.onLocation('/b/ideas/posts/post_1'))
    view.rerender({ previewing: false })
    expect(view.result.current.here).toEqual({ page: 'post', item: '/b/ideas/posts/post_1' })
    expect(view.result.current.note?.from).toEqual({ page: 'feedback', item: null })
    act(() => view.result.current.back())
    expect(view.result.current.here).toEqual({ page: 'feedback', item: null })
    expect(view.result.current.note).toBeNull()
  })

  it('keeps a changelog entry as the item, and counts each page reached', () => {
    const view = follow()
    view.rerender({ previewing: true })
    act(() => view.result.current.onLocation('/changelog'))
    act(() => view.result.current.onLocation('/changelog/entry_1'))
    view.rerender({ previewing: false })
    expect(view.result.current.here).toEqual({ page: 'changelog', item: '/changelog/entry_1' })
    expect(capture.mock.calls.map(([event, props]) => [event, props])).toEqual([
      ['designer_page_switched', { page: 'changelog', via: 'preview' }],
    ])
  })

  it('stays put when Preview went nowhere the builder draws, or nowhere at all', () => {
    const view = follow()
    view.rerender({ previewing: true })
    act(() => view.result.current.onLocation('/settings/profile'))
    act(() => view.result.current.onLocation('/hc'))
    view.rerender({ previewing: false })
    expect(view.result.current.here).toEqual({ page: 'feedback', item: null })
    expect(view.result.current.note).toBeNull()
    expect(capture).not.toHaveBeenCalled()
  })

  it('follows nothing outside Preview', () => {
    const view = follow()
    act(() => view.result.current.onLocation('/roadmap'))
    view.rerender({ previewing: true })
    view.rerender({ previewing: false })
    expect(view.result.current.here).toEqual({ page: 'feedback', item: null })
  })
})

describe('CanvasBar', () => {
  const posts = [
    { id: 'p1', title: 'Public idea', path: '/b/ideas/posts/p1' },
    { id: 'p2', title: 'Another idea', path: '/b/ideas/posts/p2' },
  ]
  const gates = {
    feedback: true,
    roadmap: true,
    changelog: true,
    help: false,
    support: false,
    status: true,
  }
  function bar(
    here: CanvasLocation,
    sample: SamplePage | null = null,
    note = false,
    on: Partial<typeof gates> = {},
    widget = false
  ) {
    const setPage = vi.fn()
    const showSample = vi.fn()
    const onBack = vi.fn()
    const { container } = render(
      <CanvasBar
        view={{ here, posts, setPage, sample, showSample, gates: { ...gates, ...on }, widget }}
        note={note ? { from: { page: 'feedback', item: null } } : null}
        onBack={onBack}
      />
    )
    return { setPage, showSample, onBack, container }
  }

  it('marks the widget a read-only sample, set in Widget settings', () => {
    bar({ page: 'roadmap', item: null }, null, false, {}, true)
    expect(screen.getByText('Sample')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Widget settings' }).getAttribute('href')).toBe(
      '/admin/settings/widget'
    )
    cleanup()
  })

  it('says nothing when there is nothing to say', () => {
    expect(bar({ page: 'roadmap', item: null }).container.textContent).toBe('')
  })

  it('names the post shown and offers the others', async () => {
    const { setPage } = bar({ page: 'post', item: '/b/ideas/posts/p1' })
    const trigger = screen.getByRole('button', { name: /Showing: Public idea/ })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const other = await screen.findByRole('menuitemradio', { name: 'Another idea' })
    fireEvent.click(other)
    expect(setPage).toHaveBeenCalledWith('post', '/b/ideas/posts/p2')
  })

  it('marks a sample, and offers Status its sample even while it is on', () => {
    bar({ page: 'help', item: null }, 'help')
    expect(screen.getByText('Sample')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show the real page' })).toBeNull()
    cleanup()
    const { showSample } = bar({ page: 'status', item: null })
    fireEvent.click(screen.getByRole('button', { name: 'Show sample content' }))
    expect(showSample).toHaveBeenCalledWith('status')
  })

  it('offers Support its sample while it is on, since its list is a signed-in visitor’s own', () => {
    const { showSample } = bar({ page: 'support', item: null }, null, false, { support: true })
    fireEvent.click(screen.getByRole('button', { name: 'Show sample content' }))
    expect(showSample).toHaveBeenCalledWith('support')
    cleanup()
    // Off, it is reached from Pages instead; the bar has nothing to add.
    expect(bar({ page: 'changelog', item: null }).container.textContent).toBe('')
  })

  it('says where Preview left the builder, and goes back', () => {
    const { onBack } = bar({ page: 'post', item: '/b/ideas/posts/p2' }, null, true)
    expect(screen.getByText('Editing: Another idea')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Feedback' }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
