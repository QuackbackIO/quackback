// @vitest-environment happy-dom
/**
 * A visitor who asks for less motion gets the similar-posts card without its
 * slide: the card's own MotionConfig honours the setting (never the portal root's).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

vi.mock('@/components/public/vote-button', () => ({ VoteButton: () => null }))

beforeAll(() => {
  // Animations run on Motion's own frame loop, as without Web Animations.
  for (
    let proto = Object.getPrototypeOf(document.body);
    proto;
    proto = Object.getPrototypeOf(proto)
  )
    if (Object.prototype.hasOwnProperty.call(proto, 'animate'))
      delete (proto as { animate?: unknown }).animate
  // The card measures its content at 120px.
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() {
      this.callback([{ contentRect: { height: 120 } } as ResizeObserverEntry], this as never)
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  // The device asks for reduced motion.
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

afterEach(cleanup)

const POST = {
  id: 'post_1',
  title: 'Dark mode',
  boardSlug: 'ideas',
  voteCount: 3,
  status: null,
} as never

describe('similar posts card with reduced motion', () => {
  it('opens at its height at once, without sliding', async () => {
    const { SimilarPostsCard } = await import('../similar-posts-card')
    const { container } = render(
      <IntlProvider locale="en" onError={() => {}}>
        <SimilarPostsCard posts={[POST]} show />
      </IntlProvider>
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const card = container.firstElementChild as HTMLElement
    // Straight to its measured height: no frames spent growing from nothing.
    expect(card.style.height).toBe('120px')
  })
})
