import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PageMeasure } from '../../render/page-scripts'
import type { SiteSignals } from '../site-signals'

const settings = vi.hoisted(() => ({
  browserUrl: undefined as string | undefined,
  browserToken: undefined as string | undefined,
}))
vi.mock('@/lib/server/config', () => ({ config: settings }))

const { fromPage, lookPalette, renderSite, renderedSignals, withRendered } =
  await import('../site-render')

const page: PageMeasure = {
  title: 'Brand',
  page: 'rgb(255, 255, 255)',
  headline: {
    family: '"Display Sans", Inter, sans-serif',
    size: 103.5,
    weight: 800,
    tracking: 0,
    leading: 0.85,
    transform: 'none',
    colour: 'rgb(22, 51, 0)',
  },
  heading: null,
  body: {
    family: 'Inter, sans-serif',
    size: 16,
    weight: 400,
    tracking: 0,
    leading: 1.5,
    transform: 'none',
    colour: 'rgb(14, 15, 12)',
  },
  button: {
    fill: 'rgb(159, 232, 112)',
    ink: 'rgb(22, 51, 0)',
    radius: 999,
    height: 48,
    borderWidth: 0,
    shadow: false,
    weight: 600,
    transform: 'none',
    text: 'Send money',
  },
  action: true,
  card: null,
  field: null,
  palette: [
    { colour: 'rgb(255, 255, 255)', share: 0.6 },
    { colour: 'rgb(159, 232, 112)', share: 0.3 },
    { colour: 'rgba(0, 0, 0, 0.4)', share: 0.1 },
  ],
  hero: 'rgb(159, 232, 112)',
}

const staticSite: SiteSignals = {
  domain: 'brand.example.com',
  title: null,
  description: 'A brand',
  colour: '#37517e',
  palette: ['#37517e', '#163300'],
  background: '#f7f7f7',
  fonts: { heading: 'Inter', body: 'Inter' },
  dark: false,
  button: '#37517e',
  bold: false,
  monochrome: false,
  hero: null,
  logo: null,
  shareImage: null,
  measured: { headline: { size: 64 }, card: { radius: 16 } },
}

describe('fromPage', () => {
  it('reads the main button, hero and type as the page renders them', () => {
    const rendered = fromPage(page)
    expect(rendered.measured.button).toMatchObject({
      fill: '#9fe870',
      ink: '#163300',
      radius: 999,
      action: true,
    })
    expect(rendered.measured.headline).toMatchObject({
      size: 103.5,
      weight: 800,
      colour: '#163300',
    })
    expect(rendered.brand).toMatchObject({
      colour: '#9fe870',
      hero: '#9fe870',
      bold: true,
      background: '#ffffff',
      dark: false,
    })
    expect(rendered.brand.fonts.heading).toBe('"Display Sans", Inter, sans-serif')
    // A dimming layer is not a colour the page is painted in.
    expect(rendered.brand.palette).toEqual(['#9fe870', '#ffffff'])
  })
})

describe('fromPage, where the page names no brand colour', () => {
  // A page with no call to action and a promotion's panel covering much of it.
  const promo: PageMeasure = {
    ...page,
    button: null,
    action: false,
    hero: null,
    palette: [
      { colour: 'rgb(255, 255, 255)', share: 0.5 },
      { colour: 'rgb(255, 219, 0)', share: 0.4 },
    ],
  }

  it('leaves the brand colour to the site, keeping a painted panel in the palette', () => {
    const rendered = fromPage(promo)
    expect(rendered.brand.colour).toBeUndefined()
    expect(rendered.brand.palette).toContain('#ffdb00')
    const merged = withRendered(
      { ...staticSite, colour: '#0058a3', palette: ['#0058a3', '#ffdb00'] },
      { ...rendered, screenshot: null }
    )
    expect(merged.colour).toBe('#0058a3')
    expect(merged.palette.slice(0, 2)).toEqual(['#0058a3', '#ffdb00'])
  })

  it('gives the screenshot palette, imagery and all, when the screenshot was read', () => {
    const rendered = fromPage(page, ['#ffffff', '#ff7a59', '#b07cff'])
    // The main call to action leads; the screenshot's colours follow in its order.
    expect(rendered.brand.palette).toEqual(['#9fe870', '#ffffff', '#ff7a59', '#b07cff'])
  })
})

describe('lookPalette', () => {
  it('leads with the site brand colour before the screen, whose first colour can be a photo', () => {
    const rendered = {
      ...fromPage({ ...page, button: null, action: false, hero: null }, ['#7c322c', '#ffdb00']),
      screenshot: null,
    }
    expect(
      lookPalette({ ...staticSite, colour: '#0058a3', palette: ['#0058a3', '#ffdb00'] }, rendered)
    ).toEqual(['#0058a3', '#7c322c', '#ffdb00'])
    expect(lookPalette(null, rendered)).toEqual(['#7c322c', '#ffdb00'])
  })

  it("keeps the site's second colour when the first screen hardly shows it", () => {
    const rendered = {
      ...fromPage({ ...page, button: null, action: false, hero: null }, [
        '#ffffff',
        '#112231',
        '#d8d4cf',
      ]),
      screenshot: null,
    }
    const site = { ...staticSite, colour: '#112231', palette: ['#112231', '#ff4f40', '#218fb7'] }
    expect(lookPalette(site, rendered)).toContain('#ff4f40')
    expect(lookPalette(site, rendered)[0]).toBe('#112231')
  })
})

describe('withRendered', () => {
  it('lets the render lead the CSS read, keeping what only the CSS read found', () => {
    const merged = withRendered(staticSite, { ...fromPage(page), screenshot: null })
    expect(merged.colour).toBe('#9fe870')
    expect(merged.palette[0]).toBe('#9fe870')
    expect(merged.palette).toContain('#163300')
    expect(merged.description).toBe('A brand')
    expect(merged.measured?.headline?.size).toBe(103.5)
    // The render found no card, so the CSS read's stands.
    expect(merged.measured?.card).toEqual({ radius: 16 })
  })

  it('stands alone when the page HTML could not be read', () => {
    const alone = renderedSignals('brand.example.com', { ...fromPage(page), screenshot: null })
    expect(alone).toMatchObject({ domain: 'brand.example.com', colour: '#9fe870', title: 'Brand' })
  })
})

describe('renderSite', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    settings.browserUrl = undefined
    settings.browserToken = undefined
  })

  it('does nothing without a reader set up', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await renderSite('brand.example.com')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('asks the reader with its token, once more if it is waking', async () => {
    settings.browserUrl = 'http://reader.internal:3200'
    settings.browserToken = 'a-long-enough-token'
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('waking', { status: 502 }))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          url: 'https://brand.example.com/',
          measure: page,
          screenshot: 'data:image/jpeg;base64,AA==',
          refused: [],
        })
      )
    vi.stubGlobal('fetch', fetch)
    const rendered = await renderSite('brand.example.com')
    expect(rendered?.brand.colour).toBe('#9fe870')
    expect(rendered?.screenshot).toBe('data:image/jpeg;base64,AA==')
    expect(fetch).toHaveBeenCalledTimes(2)
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toBe('http://reader.internal:3200/read')
    expect(init.headers.authorization).toBe('Bearer a-long-enough-token')
  })

  it('gives nothing back when the reader cannot read the site', async () => {
    settings.browserUrl = 'http://reader.internal:3200'
    settings.browserToken = 'a-long-enough-token'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ ok: false, reason: 'robots' }))
    )
    expect(await renderSite('brand.example.com')).toBeNull()
  })
})
