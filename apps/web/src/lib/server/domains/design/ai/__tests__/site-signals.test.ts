/**
 * Reading a website for its brand: the page, the stylesheets it links and its
 * manifest, from the address as given or with or without www. A site that
 * answers with a bot check or a refusal is reported as blocked, never read;
 * its manifest may still say something.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const web = vi.hoisted(() => ({
  pages: {} as Record<string, { body: string; type?: string; status?: number }>,
  asked: [] as Array<{ url: string; agent: string }>,
}))

vi.mock('@/lib/server/content/unfurl', () => ({
  fetchFollowingRedirects: async (url: string, opts: { headers?: Record<string, string> }) => {
    web.asked.push({ url, agent: opts.headers?.['user-agent'] ?? '' })
    const found = web.pages[url]
    if (!found) return null
    return {
      finalUrl: url,
      response: new Response(found.body, {
        status: found.status ?? 200,
        headers: { 'content-type': found.type ?? 'text/html; charset=utf-8' },
      }),
    }
  },
}))

const { readSiteSignals } = await import('../site-signals')

const HOME = `<!doctype html><html><head>
  <title>Example Tools &amp; Co</title>
  <meta name="description" content="Tools for teams who ship.">
  <link rel="stylesheet" href="/assets/site.css">
  <link rel="manifest" href="/site.webmanifest">
  <meta property="og:image" content="/og.jpg">
  <style>.btn-primary { background: #0f766e; }</style>
</head><body><header><a class="site-logo" href="/"><svg viewBox="0 0 120 30"><path fill="var(--brand-primary)"/></svg></a></header></body></html>`

const CSS = `:root { --brand-primary: #0f766e; --grey: #e5e7eb; }
body { background: #fffdf8; font-family: "IBM Plex Sans", sans-serif; }
h1, h2 { font-family: 'Fraunces', serif; }
a { color: #b45309; }
.card { border-color: #e5e7eb; }`

beforeEach(() => {
  web.pages = {}
  web.asked = []
})

describe('readSiteSignals', () => {
  it('draws a logo in the page’s current colour in the site’s most vivid colour', async () => {
    web.pages['https://example.com/'] = {
      body: `<html><head><style>body { color: #112231; background: #ffffff } .btn { background: #112231 } a { color: #ff4f40 }</style></head>
        <body><header><a class="logo" href="/"><svg viewBox="0 0 120 30"><path fill="currentColor"/></svg></a></header></body></html>`,
    }
    const read = await readSiteSignals('example.com')
    expect(read.ok && read.signals.logo).toEqual({
      svg: '<svg viewBox="0 0 120 30"><path fill="#ff4f40"/></svg>',
    })
  })

  it('reads the colours, background and fonts the site uses, saying who is asking', async () => {
    web.pages['https://example.com/'] = { body: HOME }
    web.pages['https://example.com/assets/site.css'] = { body: CSS, type: 'text/css' }
    web.pages['https://example.com/site.webmanifest'] = {
      body: '{"name":"Example","theme_color":"#0f766e","background_color":"#fffdf8"}',
      type: 'application/manifest+json',
    }
    const read = await readSiteSignals('https://example.com/pricing')
    expect(read).toEqual({
      ok: true,
      signals: {
        domain: 'example.com',
        title: 'Example Tools & Co',
        description: 'Tools for teams who ship.',
        colour: '#0f766e',
        palette: ['#0f766e', '#b45309'],
        background: '#fffdf8',
        fonts: { heading: 'Fraunces', body: 'IBM Plex Sans' },
        dark: false,
        button: '#0f766e',
        bold: false,
        monochrome: false,
        hero: null,
        // The header logo with the colour its page gives it, and the link preview image.
        logo: { svg: '<svg viewBox="0 0 120 30"><path fill="#0f766e"/></svg>' },
        shareImage: 'https://example.com/og.jpg',
      },
    })
    expect(web.asked[0]!.agent).toMatch(/QuackbackBrandReader/)
  })

  it('tries the address with www when the bare one does not answer', async () => {
    web.pages['https://www.example.com/'] = { body: HOME }
    const read = await readSiteSignals('example.com')
    expect(read.ok && read.signals.title).toBe('Example Tools & Co')
    expect(web.asked.map((asked) => asked.url).slice(0, 2)).toEqual([
      'https://example.com/',
      'https://www.example.com/',
    ])
  })

  it('follows a page that only sends the visitor on, once', async () => {
    web.pages['https://example.com/'] = {
      body: '<html><head><title>Redirecting</title><meta http-equiv="refresh" content="0; url=https://example.com/en-gb/"></head></html>',
    }
    web.pages['https://example.com/en-gb/'] = { body: HOME }
    const read = await readSiteSignals('example.com')
    expect(read.ok && read.signals.title).toBe('Example Tools & Co')
  })

  it('reports a bot check or a refusal as blocked, and reads the manifest if it is served', async () => {
    web.pages['https://example.com/'] = { body: '<title>Just a moment...</title>', status: 200 }
    web.pages['https://www.example.com/'] = { body: 'denied', status: 403 }
    expect(await readSiteSignals('example.com')).toEqual({ ok: false, reason: 'blocked' })

    web.pages['https://example.com/manifest.json'] = {
      body: '{"name":"Example","theme_color":"#7c3aed"}',
      type: 'application/json',
    }
    const read = await readSiteSignals('example.com')
    expect(read.ok && read.signals).toMatchObject({ title: 'Example', colour: '#7c3aed' })
  })

  it('gives unreachable for a page that is not HTML, not there, or not a website', async () => {
    web.pages['https://example.com/'] = { body: '{}', type: 'application/json' }
    expect(await readSiteSignals('example.com')).toEqual({ ok: false, reason: 'unreachable' })
    expect(await readSiteSignals('not a website')).toEqual({ ok: false, reason: 'unreachable' })
  })
})
