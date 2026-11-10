// @vitest-environment happy-dom
/**
 * The design channel of usePreviewPosting. A design equal to the one the
 * frame holds is never sent again. Paced, as the builder's canvas posts, a
 * change goes on the next animation frame, and while the frame is still
 * drawing one design only the latest of those made meanwhile follows it,
 * once the frame says it drew, or after a while if it never says so.
 */
import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { DRAWN_WAIT_MS, usePreviewPosting } from '../use-preview-posting'

const NO_DRAFT = {}

/** A frame whose window records what it is sent. */
function frame() {
  const post = vi.fn()
  const win = { postMessage: post } as unknown as Window
  const iframe = document.createElement('iframe')
  Object.defineProperty(iframe, 'contentWindow', { configurable: true, get: () => win })
  return { ref: { current: iframe }, post, win }
}

/** What the frame says, as its portal page does. */
function says(win: Window, type: string) {
  act(() => {
    fireEvent(
      window,
      new MessageEvent('message', { data: { type }, origin: window.location.origin, source: win })
    )
  })
}

const designs = (post: ReturnType<typeof vi.fn>) =>
  post.mock.calls
    .map(([message]) => message as { type: string; design?: PortalDesign })
    .filter((message) => message.type === 'quackback:preview-design')
    .map((message) => message.design?.pages.feedback.headline)

/** A design with a headline of its own, to tell one from another. */
function titled(headline: string): PortalDesign {
  const design = defaultDesign()
  design.pages.feedback.headline = headline as never
  return design
}

const nextFrame = () => act(() => vi.advanceTimersByTime(20))

function posting(paced: boolean, first: PortalDesign) {
  const { ref, post, win } = frame()
  const hook = renderHook(
    ({ design }) =>
      usePreviewPosting(ref, {
        draftCss: '',
        cssDirty: false,
        draft: NO_DRAFT,
        draftDirty: false,
        design,
        paced,
      }),
    { initialProps: { design: first } }
  )
  return { post, win, show: (design: PortalDesign) => hook.rerender({ design }) }
}

beforeEach(() =>
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
  })
)
afterEach(() => vi.useRealTimers())

describe('usePreviewPosting, paced', () => {
  it('sends a change on the next frame, not after a pause', () => {
    const { post } = posting(true, titled('one'))
    nextFrame()
    expect(designs(post)).toEqual(['one'])
  })

  it('holds the changes made while the frame draws, then sends only the latest', () => {
    const { post, win, show } = posting(true, titled('one'))
    nextFrame()
    show(titled('two'))
    nextFrame()
    show(titled('three'))
    nextFrame()
    expect(designs(post)).toEqual(['one'])
    says(win, 'quackback:preview-drawn')
    expect(designs(post)).toEqual(['one', 'three'])
  })

  it('sends the latest anyway when the frame never says it drew', () => {
    const { post, show } = posting(true, titled('one'))
    nextFrame()
    show(titled('two'))
    nextFrame()
    act(() => vi.advanceTimersByTime(DRAWN_WAIT_MS))
    expect(designs(post)).toEqual(['one', 'two'])
  })

  it('never sends a design equal to the one the frame holds', () => {
    const { post, win, show } = posting(true, titled('one'))
    nextFrame()
    says(win, 'quackback:preview-drawn')
    // The same draft read back afresh, as after a publish.
    show(titled('one'))
    nextFrame()
    expect(designs(post)).toEqual(['one'])
  })

  it('sends the design again to a frame that loaded afresh', () => {
    const { post, win } = posting(true, titled('one'))
    nextFrame()
    says(win, 'quackback:preview-ready')
    expect(designs(post)).toEqual(['one', 'one'])
  })
})

describe('usePreviewPosting, unpaced', () => {
  it('sends the latest change after a pause, and not an equal one again', () => {
    const { post, show } = posting(false, titled('one'))
    nextFrame()
    show(titled('two'))
    act(() => vi.advanceTimersByTime(200))
    expect(designs(post)).toEqual(['two'])
    show(titled('two'))
    act(() => vi.advanceTimersByTime(200))
    expect(designs(post)).toEqual(['two'])
  })
})
