/**
 * A website's brand signals come from its head: the name, the description and
 * a theme colour dark enough to carry white text. Anything that is not an
 * HTML page gives nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const site = vi.hoisted(() => ({
  html: '',
  type: 'text/html; charset=utf-8',
  status: 200,
  urls: [] as string[],
}))

vi.mock('@/lib/server/content/unfurl', () => ({
  fetchFollowingRedirects: async (url: string) => {
    site.urls.push(url)
    return {
      finalUrl: url,
      response: new Response(site.html, {
        status: site.status,
        headers: { 'content-type': site.type },
      }),
    }
  },
}))

const { readSiteSignals } = await import('../site-signals')

const page = (themeColor: string) => `<!doctype html><html><head>
  <title>Example Tools</title>
  <meta name="description" content="Tools for teams who ship.">
  <meta name="theme-color" content="${themeColor}">
</head><body>Hello</body></html>`

beforeEach(() => {
  site.html = page('#0F766E')
  site.type = 'text/html; charset=utf-8'
  site.status = 200
  site.urls = []
})

describe('readSiteSignals', () => {
  it('reads the name, the description and the theme colour from the home page', async () => {
    expect(await readSiteSignals('https://www.example.com/pricing')).toEqual({
      domain: 'www.example.com',
      title: 'Example Tools',
      description: 'Tools for teams who ship.',
      colour: '#0f766e',
    })
    expect(site.urls).toEqual(['https://www.example.com/'])
  })

  it('drops a theme colour too light to carry white text', async () => {
    site.html = page('#fefce8')
    expect((await readSiteSignals('example.com'))?.colour).toBeNull()
  })

  it('gives nothing for a page that is not HTML, or not there', async () => {
    site.type = 'application/json'
    expect(await readSiteSignals('example.com')).toBeNull()
    site.type = 'text/html'
    site.status = 404
    expect(await readSiteSignals('example.com')).toBeNull()
    expect(await readSiteSignals('not a website')).toBeNull()
  })
})
