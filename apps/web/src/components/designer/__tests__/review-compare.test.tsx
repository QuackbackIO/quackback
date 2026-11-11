// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true, "handleDisabledFileLoadingAsSuccess": true } }
/**
 * Review shows any page before and after, opening on the one being designed
 * when it changed, a post at its own address. The After frame's page is drawn
 * by the server with the draft, and both frames go to another page in place,
 * so switching pages loads no new document.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DesignChange } from '@/lib/shared/design/diff'
import { defaultDesign } from '@/lib/shared/design/schema'

vi.mock('@tanstack/react-router', () => ({
  ClientOnly: ({ children }: { children: React.ReactNode }) => children,
}))
const media = vi.hoisted(() => ({ wide: false }))
vi.mock('../ai-pane', () => ({ useViewportWidth: () => (media.wide ? 1440 : 800) }))

const { ReviewCompare, openingPage } = await import('../review-compare')

afterEach(() => {
  cleanup()
  media.wide = false
})

const design = defaultDesign()
const BRAND: DesignChange[] = [{ path: 'brand.light.accent', before: '#d9202b', after: '#1d4ed8' }]
const ROADMAP: DesignChange[] = [{ path: 'pages.roadmap.columns', before: 3, after: 4 }]

const frames = () => [...document.querySelectorAll('iframe')]
const after = () => document.querySelector<HTMLIFrameElement>('iframe[title^="After you publish"]')!

function show(props: Partial<Parameters<typeof ReviewCompare>[0]> = {}) {
  return render(
    <ReviewCompare
      page="feedback"
      pages={['feedback', 'roadmap', 'post']}
      postPath="/b/ideas/posts/p1"
      theme="light"
      locale="en"
      sort="top"
      live={design}
      draft={design}
      changes={BRAND}
      {...props}
    />
  )
}

describe('ReviewCompare', () => {
  it('waits on the After frame, not the live one, until it has drawn the draft', () => {
    show()
    const [live, after] = [...document.querySelectorAll('figure')]
    expect(live!.querySelector('[data-canvas-skeleton]')).toBeNull()
    expect(after!.querySelector('[data-canvas-skeleton]')).not.toBeNull()
  })

  it('loads the After page drawn by the server with the draft, so it shows it at once', () => {
    show()
    expect(new URL(after().src, 'http://x').searchParams.get('design')).toBe('draft')
    const live = document.querySelector<HTMLIFrameElement>('iframe[title^="Live now"]')!
    expect(new URL(live.src, 'http://x').searchParams.get('design')).toBeNull()
  })

  it('goes to another page in place, in the same frames, loading no new document', () => {
    show()
    const before = frames()
    const sources = before.map((frame) => frame.getAttribute('src'))
    fireEvent.click(screen.getByRole('button', { name: /^A post/ }))
    expect(frames()).toEqual(before)
    expect(frames().map((frame) => frame.getAttribute('src'))).toEqual(sources)
    expect(after().title).toContain('A post')
    expect(screen.getByRole('button', { name: /^A post/ }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('marks each page the draft changes, for a screen reader too', () => {
    show({ changes: ROADMAP })
    expect(screen.getByRole('button', { name: 'Roadmap, changed' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Feedback' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Widget' })).toBeTruthy()
  })

  it('opens on the first page changed when the page being designed did not change', () => {
    show({ changes: ROADMAP })
    expect(
      screen.getByRole('button', { name: 'Roadmap, changed' }).getAttribute('aria-pressed')
    ).toBe('true')
    expect(after().title).toContain('Roadmap')
    expect(screen.queryByText('No visible change on this page.')).toBeNull()
  })

  it('says quietly when the page shown has no change', () => {
    show({ changes: ROADMAP })
    fireEvent.click(screen.getByRole('button', { name: 'Feedback' }))
    expect(screen.getByText('No visible change on this page.')).toBeTruthy()
  })

  it('takes turns below the width for side by side, the draft first', () => {
    show()
    const group = screen.getByRole('radiogroup', { name: 'Show' })
    expect([...group.querySelectorAll('[role=radio]')].map((each) => each.textContent)).toEqual([
      'Live now',
      'After you publish',
    ])
    const [live, draft] = [...document.querySelectorAll('figure')]
    expect(live!.className).toContain('hidden')
    expect(draft!.className).not.toContain('hidden')
    fireEvent.click(screen.getByRole('radio', { name: 'Live now' }))
    expect(live!.className).not.toContain('hidden')
    expect(draft!.className).toContain('hidden')
  })

  it('shows both side by side where the window is wide enough, or one on asking', () => {
    media.wide = true
    show()
    const group = screen.getByRole('radiogroup', { name: 'Show' })
    expect(screen.getByRole('radio', { name: 'Side by side' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    expect(group.querySelectorAll('[role=radio]')).toHaveLength(3)
    const figures = [...document.querySelectorAll('figure')]
    expect(figures.map((each) => each.className.includes('hidden'))).toEqual([false, false])
    fireEvent.click(screen.getByRole('radio', { name: 'After you publish' }))
    expect(figures.map((each) => each.className.includes('hidden'))).toEqual([true, false])
  })

  it('shows the widget before and after, since the brand reaches it too, keeping the pages loaded', () => {
    show({ pages: ['feedback'] })
    const pageFrames = () => frames().filter((frame) => !frame.title.startsWith('Widget'))
    const pages = pageFrames()
    fireEvent.click(screen.getByRole('button', { name: /^Widget/ }))
    expect(screen.getByRole('button', { name: /^Widget/ }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    expect(
      frames()
        .filter((frame) => frame.title.startsWith('Widget'))
        .map((frame) => frame.getAttribute('src'))
    ).toEqual([
      '/widget?theme=light&locale=en&preview=true',
      '/widget?theme=light&locale=en&preview=true',
    ])
    expect(screen.getByTitle('Widget, live now')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Feedback/ }))
    expect(pageFrames()).toEqual(pages)
  })
})

describe('openingPage', () => {
  it('is the page being designed when it changed, else the first changed, else the one designed', () => {
    const pages = ['home', 'feedback', 'roadmap'] as const
    expect(openingPage('feedback', pages, new Set(['feedback', 'roadmap']))).toBe('feedback')
    expect(openingPage('feedback', pages, new Set(['roadmap']))).toBe('roadmap')
    expect(openingPage('feedback', pages, new Set())).toBe('feedback')
  })
})
