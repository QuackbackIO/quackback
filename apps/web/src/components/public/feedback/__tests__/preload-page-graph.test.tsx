// @vitest-environment node
/** The server's page names the landing page's chunk in its head, before the content. */
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('virtual:quackback-lazy-graphs', () => ({
  default: { home: '/assets/portal-home-abc.js', feed: '/assets/feed-page-abc.js' },
}))

const { preloadPageGraph } = await import('../feed-route')

function Page({ page }: { page: 'home' | 'feed' }) {
  preloadPageGraph(page)
  return <main>page</main>
}

const draw = (page: 'home' | 'feed') =>
  renderToString(
    <html>
      <head />
      <body>
        <Page page={page} />
      </body>
    </html>
  )

describe('preloadPageGraph', () => {
  it("starts the drawn page's chunk as a module script in the head", () => {
    const html = draw('home')
    const tag = html.indexOf('<script src="/assets/portal-home-abc.js" type="module" async="">')
    expect(tag).toBeGreaterThan(-1)
    expect(tag).toBeLessThan(html.indexOf('</head>'))
    expect(html).not.toContain('feed-page-abc')
  })

  it("names only the feed's chunk on the feed", () => {
    expect(draw('feed')).toContain('/assets/feed-page-abc.js')
    expect(draw('feed')).not.toContain('portal-home-abc')
  })
})
