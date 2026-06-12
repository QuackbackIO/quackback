import { describe, it, expect } from 'vitest'
import { parseOpenGraph } from '../og-parse'

const BASE = 'https://example.com/page'

describe('parseOpenGraph', () => {
  it('extracts og: meta tags', () => {
    const html = `<html><head>
      <meta property="og:title" content="My Title" />
      <meta property="og:description" content="My Desc" />
      <meta property="og:site_name" content="My Site" />
      <meta property="og:image" content="https://example.com/img.jpg" />
    </head></html>`
    expect(parseOpenGraph(html, BASE)).toEqual({
      title: 'My Title',
      description: 'My Desc',
      siteName: 'My Site',
      imageUrl: 'https://example.com/img.jpg',
      faviconUrl: 'https://example.com/favicon.ico',
    })
  })

  it('falls back to twitter: tags when og: absent', () => {
    const html = `<html><head>
      <meta name="twitter:title" content="TW Title" />
      <meta name="twitter:description" content="TW Desc" />
      <meta name="twitter:image" content="https://cdn.example.com/tw.png" />
    </head></html>`
    const result = parseOpenGraph(html, BASE)
    expect(result.title).toBe('TW Title')
    expect(result.description).toBe('TW Desc')
    expect(result.imageUrl).toBe('https://cdn.example.com/tw.png')
  })

  it('falls back to <title> and <meta name="description">', () => {
    const html = `<html><head>
      <title>Page Title</title>
      <meta name="description" content="Page desc" />
    </head></html>`
    const result = parseOpenGraph(html, BASE)
    expect(result.title).toBe('Page Title')
    expect(result.description).toBe('Page desc')
    expect(result.imageUrl).toBeNull()
  })

  it('og: takes precedence over twitter: which takes precedence over fallback', () => {
    const html = `<html><head>
      <title>HTML Title</title>
      <meta name="twitter:title" content="TW Title" />
      <meta property="og:title" content="OG Title" />
    </head></html>`
    expect(parseOpenGraph(html, BASE).title).toBe('OG Title')
  })

  it('resolves relative image urls against baseUrl', () => {
    const html = `<html><head>
      <meta property="og:image" content="/images/cover.jpg" />
    </head></html>`
    expect(parseOpenGraph(html, BASE).imageUrl).toBe('https://example.com/images/cover.jpg')
  })

  it('rejects non-http/https image urls', () => {
    const html = `<html><head>
      <meta property="og:image" content="ftp://example.com/img.png" />
    </head></html>`
    expect(parseOpenGraph(html, BASE).imageUrl).toBeNull()
  })

  it('decodes HTML entities in extracted values', () => {
    const html = `<html><head>
      <meta property="og:title" content="Tom &amp; Jerry &#39;s &quot;Show&quot;" />
    </head></html>`
    expect(parseOpenGraph(html, BASE).title).toBe('Tom & Jerry \'s "Show"')
  })

  it('does not double-decode entities', () => {
    // "&amp;lt;" is an escaped ampersand followed by literal "lt;" — it must
    // decode to "&lt;" (text), never cascade to "<".
    const html = `<html><head>
      <meta property="og:title" content="&amp;lt;script&amp;gt; and &amp;amp; and &amp;#60;" />
    </head></html>`
    expect(parseOpenGraph(html, BASE).title).toBe('&lt;script&gt; and &amp; and &#60;')
  })

  it('caps title at 200 chars, description at 500, siteName at 100', () => {
    const long = 'x'.repeat(600)
    const html = `<html><head>
      <meta property="og:title" content="${long}" />
      <meta property="og:description" content="${long}" />
      <meta property="og:site_name" content="${long}" />
    </head></html>`
    const result = parseOpenGraph(html, BASE)
    expect(result.title!.length).toBe(200)
    expect(result.description!.length).toBe(500)
    expect(result.siteName!.length).toBe(100)
  })

  it('returns nulls when no relevant meta tags are present', () => {
    expect(parseOpenGraph('<html><body>hello</body></html>', BASE)).toEqual({
      title: null,
      description: null,
      siteName: null,
      imageUrl: null,
      faviconUrl: 'https://example.com/favicon.ico',
    })
  })

  it('handles attribute order: content before property', () => {
    const html = `<html><head>
      <meta content="Reversed" property="og:title" />
    </head></html>`
    expect(parseOpenGraph(html, BASE).title).toBe('Reversed')
  })

  it('only scans up to </head> and caps at 200KB', () => {
    // A huge body after </head> should not affect the result
    const html = `<html><head>
      <meta property="og:title" content="Scoped" />
    </head><body>${'x'.repeat(300_000)}</body></html>`
    expect(parseOpenGraph(html, BASE).title).toBe('Scoped')
  })

  it('never throws on malformed html', () => {
    expect(() => parseOpenGraph('not html at all << >>', 'not-a-url')).not.toThrow()
    expect(() => parseOpenGraph('', '')).not.toThrow()
  })
})

describe('faviconUrl parsing', () => {
  it('extracts apple-touch-icon with highest priority', () => {
    const html = `<html><head>
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <link rel="icon" href="/favicon.png" />
    </head></html>`
    expect(parseOpenGraph(html, BASE).faviconUrl).toBe('https://example.com/apple-touch-icon.png')
  })

  it('falls back to rel="icon" when no apple-touch-icon', () => {
    const html = `<html><head>
      <link rel="icon" href="https://cdn.example.com/icon.png" />
    </head></html>`
    expect(parseOpenGraph(html, BASE).faviconUrl).toBe('https://cdn.example.com/icon.png')
  })

  it('falls back to rel="shortcut icon"', () => {
    const html = `<html><head>
      <link rel="shortcut icon" href="/fav.ico" />
    </head></html>`
    expect(parseOpenGraph(html, BASE).faviconUrl).toBe('https://example.com/fav.ico')
  })

  it('falls back to /favicon.ico when no link tags present', () => {
    const html = `<html><head><title>No Icons</title></head></html>`
    expect(parseOpenGraph(html, 'https://site.example/page').faviconUrl).toBe(
      'https://site.example/favicon.ico'
    )
  })

  it('resolves relative favicon href against baseUrl', () => {
    const html = `<html><head><link rel="icon" href="/static/icon.png" /></head></html>`
    expect(parseOpenGraph(html, 'https://app.example/page').faviconUrl).toBe(
      'https://app.example/static/icon.png'
    )
  })

  it('skips non-http favicon href and falls back to /favicon.ico', () => {
    const html = `<html><head><link rel="icon" href="ftp://bad.example/icon.ico" /></head></html>`
    expect(parseOpenGraph(html, BASE).faviconUrl).toBe('https://example.com/favicon.ico')
  })

  it('treats apple-touch-icon-precomposed as an apple icon', () => {
    const html = `<html><head>
      <link rel="apple-touch-icon-precomposed" href="/touch.png" />
      <link rel="icon" href="/favicon.png" />
    </head></html>`
    expect(parseOpenGraph(html, BASE).faviconUrl).toBe('https://example.com/touch.png')
  })

  it('matches rel tokens regardless of order (e.g. rel="icon shortcut")', () => {
    const html = `<html><head><link rel="icon shortcut" href="/fav.ico" /></head></html>`
    expect(parseOpenGraph(html, BASE).faviconUrl).toBe('https://example.com/fav.ico')
  })
})
