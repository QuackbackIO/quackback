// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "handleDisabledFileLoadingAsSuccess": true } }
/**
 * Review shows any page before and after, opening on the one being designed,
 * a post at its own address.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  ClientOnly: ({ children }: { children: React.ReactNode }) => children,
}))

const { ReviewCompare } = await import('../review-compare')

afterEach(cleanup)

const design = {} as never

describe('ReviewCompare', () => {
  it('opens on the page being designed, and shows another when asked', () => {
    render(
      <ReviewCompare
        page="feedback"
        pages={['feedback', 'roadmap', 'post']}
        postPath="/b/ideas/posts/p1"
        theme="light"
        locale="en"
        sort="top"
        live={design}
        draft={design}
      />
    )
    const paths = () =>
      [...document.querySelectorAll('iframe')].map(
        (frame) => new URL(frame.src, 'http://x').pathname
      )
    expect(paths()).toEqual(['/feedback', '/feedback'])
    fireEvent.click(screen.getByRole('button', { name: 'A post' }))
    expect(paths()).toEqual(['/b/ideas/posts/p1', '/b/ideas/posts/p1'])
    expect(screen.getByRole('button', { name: 'A post' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows the widget before and after, since the brand reaches it too', () => {
    render(
      <ReviewCompare
        page="feedback"
        pages={['feedback']}
        theme="light"
        locale="en"
        sort="top"
        live={design}
        draft={design}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Widget' }))
    expect(screen.getByRole('button', { name: 'Widget' }).getAttribute('aria-pressed')).toBe('true')
    expect(
      [...document.querySelectorAll('iframe')].map((frame) => frame.getAttribute('src'))
    ).toEqual([
      '/widget?theme=light&locale=en&preview=true',
      '/widget?theme=light&locale=en&preview=true',
    ])
    expect(screen.getByTitle('Widget, live now')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Feedback' }))
    expect(document.querySelector('iframe')?.getAttribute('src')).toMatch(/^\/feedback/)
  })
})
