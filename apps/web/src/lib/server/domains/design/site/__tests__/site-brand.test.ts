/**
 * Use from your website, with no model: the site's logo file, favicon,
 * share image and one brand colour, read from its code and stored, offered
 * to check. Font names are left out. What is plainly not a website, or a
 * site that cannot be read, is refused as a value.
 */
import { describe, expect, it, vi } from 'vitest'
import { brandColourOf, readSiteBrand } from '../site-brand'
import type { SiteAsset, SiteFacts, SiteRead } from '../types'

const facts = (over: Partial<SiteFacts> = {}): SiteFacts => ({
  url: 'https://www.acme.test/',
  name: 'Acme',
  nameFrom: 'og:site_name',
  language: 'en',
  description: null,
  themeColour: null,
  favicons: [],
  manifest: null,
  logos: [],
  shareImage: null,
  fonts: { heading: null, body: null, faces: [], hosted: [] },
  colours: [],
  stylesheets: [],
  ...over,
})
const asset = (from: SiteAsset['from'], width = 64, height = 64): SiteAsset => ({
  url: `https://acme.test/${from}`,
  mime: 'image/png',
  bytes: new Uint8Array([1, 2, 3]),
  width,
  height,
  from,
})
const site = (over: Partial<SiteRead> = {}): SiteRead => ({
  facts: facts({ colours: [{ hex: '#0058a3', from: '--brand-primary', weight: 3 }] }),
  favicon: asset('icon'),
  logo: asset('header-img'),
  shareImage: asset('share', 1200, 630),
  failed: null,
  ...over,
})
const store = vi.fn(async (_bytes: Uint8Array, _mime: string, kind: string) => `logos/${kind}.png`)

describe('readSiteBrand', () => {
  it('offers the logo, favicon, share image and one colour, stored', async () => {
    const read = vi.fn(async () => site())
    const result = await readSiteBrand('acme.test', { read, store })
    expect(read).toHaveBeenCalledWith('https://acme.test/')
    expect(result).toEqual({
      ok: true,
      offer: {
        host: 'acme.test',
        name: 'Acme',
        logo: { key: 'logos/logo.png', full: false },
        favicon: { key: 'logos/favicon.png' },
        shareImage: { key: 'logos/share.png' },
        colour: '#0058a3',
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/font/i)
  })

  it('takes a wide logo as a full logo, and never a social banner as the logo', async () => {
    const wide = await readSiteBrand('acme.test', {
      read: async () => site({ logo: asset('header-img', 300, 60) }),
      store,
    })
    expect(wide.ok && wide.offer.logo).toEqual({ key: 'logos/logo.png', full: true })
    const banner = await readSiteBrand('acme.test', {
      read: async () => site({ logo: asset('og-image', 1200, 630) }),
      store,
    })
    expect(banner.ok && banner.offer.logo).toBeNull()
  })

  it('refuses what is not a public website, before any read', async () => {
    const read = vi.fn()
    const result = await readSiteBrand('localhost', { read, store })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_URL' })
    expect(read).not.toHaveBeenCalled()
  })

  it('says so when the site cannot be read, or gives nothing to use', async () => {
    const unread = await readSiteBrand('acme.test', {
      read: async () => site({ facts: null, failed: 'fetch_failed' }),
      store,
    })
    expect(unread).toMatchObject({ ok: false, code: 'SITE_UNREADABLE' })
    const empty = await readSiteBrand('acme.test', {
      read: async () => site({ facts: facts(), favicon: null, logo: null, shareImage: null }),
      store,
    })
    expect(empty).toMatchObject({ ok: false, code: 'NOTHING_FOUND' })
  })
})

describe('brandColourOf', () => {
  it('takes the strongest named colour that is a colour, not a grey', () => {
    expect(
      brandColourOf(
        facts({
          colours: [
            { hex: '#111111', from: '--brand', weight: 3 },
            { hex: '#e4002b', from: 'button background', weight: 2 },
          ],
        })
      )
    ).toBe('#e4002b')
    expect(brandColourOf(facts({ themeColour: '#7c3aed' }))).toBe('#7c3aed')
    expect(
      brandColourOf(facts({ colours: [{ hex: '#ffffff', from: '--brand', weight: 3 }] }))
    ).toBeNull()
  })
})
