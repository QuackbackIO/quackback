import { describe, expect, it } from 'vitest'
import {
  cardStyleOf,
  headingsOf,
  mapBrandRead,
  type BrandDraft,
  type BrandRead,
} from '../brand-import'
import measured from './fixtures/brand-sites/measured.json'
import brandReads from './fixtures/brand-sites/brand-reads.json'
import { brandReadFromMeasured, type MeasuredSite } from './fixtures/brand-sites/from-measured'

const reads = brandReads as Record<string, BrandRead>

describe('the measured brand fixtures', () => {
  it('are the measurements, converted by the one stated rule', () => {
    const derived = Object.fromEntries(
      Object.entries(measured as Record<string, MeasuredSite>).map(([site, m]) => [
        site,
        brandReadFromMeasured(m),
      ])
    )
    expect(JSON.parse(JSON.stringify(derived))).toEqual(reads)
  })
})

/** What the editor should be offered for each measured site (spec section 9). */
const EXPECTED: Record<string, BrandDraft> = {
  'stripe.com': {
    primary: '#533afd',
    background: '#ffffff',
    scheme: 'light',
    font: { site: 'Sohne', id: 'inter', exact: false },
    radius: 0.25,
    buttonShape: 'corners',
    buttonPx: 4,
    logo: { kind: 'wide' },
    missing: [],
  },
  'www.ikea.com': {
    primary: '#111111',
    background: '#fffefb',
    scheme: 'light',
    font: { site: 'Noto IKEA', id: 'roboto', exact: false },
    radius: 0.5,
    buttonShape: 'pill',
    logo: { kind: 'wide' },
    missing: [],
  },
  'linear.app': {
    primary: '#e5e5e6',
    background: '#08090a',
    scheme: 'dark',
    font: { site: 'Inter', id: 'inter', exact: true },
    radius: 0.5,
    buttonShape: 'pill',
    logo: { kind: 'wide' },
    missing: [],
  },
  'notion.com': {
    primary: '#0075de',
    background: '#ffffff',
    scheme: 'light',
    font: { site: 'Notion Inter', id: 'inter', exact: false },
    radius: 0.5,
    buttonShape: 'corners',
    buttonPx: 8,
    missing: ['logo'],
  },
}

describe('mapBrandRead on the measured sites', () => {
  it.each(Object.keys(EXPECTED))('%s', (site) => {
    expect(mapBrandRead(reads[site])).toEqual(EXPECTED[site])
  })

  it('covers every measured site', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(reads).sort())
  })
})

describe('mapBrandRead rules', () => {
  const base: BrandRead = { page: { background: '#ffffff' } }

  it('takes the main colour from the button, then the theme colour, then a saturated palette colour', () => {
    expect(
      mapBrandRead({ ...base, button: { fill: '#123456' }, themeColor: '#ff0000' }).primary
    ).toBe('#123456')
    expect(mapBrandRead({ ...base, themeColor: '#ff0000' }).primary).toBe('#ff0000')
    expect(
      mapBrandRead({
        ...base,
        palette: [
          { hex: '#777777', share: 0.6 },
          { hex: '#0a7f4f', share: 0.3 },
        ],
      }).primary
    ).toBe('#0a7f4f')
    expect(mapBrandRead({ ...base, palette: [{ hex: '#777777', share: 1 }] }).missing).toContain(
      'colour'
    )
  })

  it('takes the site’s text colour only when it also reads on the quiet fill', () => {
    // A grey that passes on the page but not on the active tab or a chip is left to the automatic text.
    const grey = mapBrandRead({ page: { background: '#f9fafb', text: '#6b7280' } })
    expect(grey.text).toBeUndefined()
    const slate = mapBrandRead({ page: { background: '#f9fafb', text: '#374151' } })
    expect(slate.text).toBe('#374151')
  })

  it('takes no page colour from a mid-tone, where neither dark nor light text reads strongly', () => {
    // A mid blue behind a splash screen: coloured text (a tag, a vote count) could not read on it.
    const mid = mapBrandRead({ page: { background: '#0090e3' } })
    expect(mid.background).toBeUndefined()
    expect(mid.scheme).toBeUndefined()
    expect(mid.missing).toContain('page')
    // A deep colour and a bright one both carry text well, and stand.
    expect(mapBrandRead({ page: { background: '#1a2081' } }).background).toBe('#1a2081')
    expect(mapBrandRead({ page: { background: '#ffe600' } }).background).toBe('#ffe600')
  })

  it('never takes a grey button that barely shows on the page for the main colour', () => {
    // A pale grey button on white is no call to action: buttons in it would vanish.
    const pale = { ...base, button: { fill: '#efefef' as const } }
    expect(mapBrandRead({ ...pale, palette: [{ hex: '#0019a8', share: 0.4 }] }).primary).toBe(
      '#0019a8'
    )
    expect(mapBrandRead(pale).missing).toContain('colour')
    // The black button on a light page and the white one on a dark page still stand.
    expect(mapBrandRead({ ...base, button: { fill: '#1f1f1f' } }).primary).toBe('#1f1f1f')
    expect(
      mapBrandRead({ page: { background: '#0f1924' }, button: { fill: '#e5e5e6' } }).primary
    ).toBe('#e5e5e6')
  })

  it('never takes a grey theme colour that barely shows on the page for the main colour', () => {
    // A dark site's black theme colour tints the browser's bar; buttons in it would vanish.
    const dark = { page: { background: '#252525' as const, text: '#cfcfcf' as const } }
    expect(mapBrandRead({ ...dark, themeColor: '#000000' }).primary).toBeUndefined()
    expect(mapBrandRead({ ...dark, themeColor: '#000000' }).missing).toContain('colour')
    // One that shows still leads.
    expect(mapBrandRead({ ...dark, themeColor: '#f5f5f5' }).primary).toBe('#f5f5f5')
    expect(mapBrandRead({ ...base, themeColor: '#111111' }).primary).toBe('#111111')
  })

  it('takes a brand theme or logo colour over a black, white or grey button', () => {
    const black = { ...base, button: { fill: '#1f1f1f' as const } }
    expect(mapBrandRead({ ...black, themeColor: '#ff7a59' }).primary).toBe('#ff7a59')
    expect(mapBrandRead({ ...black, logoColour: '#ff385c' }).primary).toBe('#ff385c')
    // A grey theme or logo colour is no brand signal: the button stands.
    expect(mapBrandRead({ ...black, themeColor: '#1e2327', logoColour: '#171717' }).primary).toBe(
      '#1f1f1f'
    )
    // A coloured button always wins.
    expect(
      mapBrandRead({ ...base, button: { fill: '#0061fe' }, logoColour: '#ff385c' }).primary
    ).toBe('#0061fe')
  })

  describe('the page palette, translated', () => {
    const light = { background: '#eeefe9' as const, text: '#151515' as const }

    it('keeps a card, border and quieter text that read well on the page', () => {
      const draft = mapBrandRead({
        page: { ...light, card: '#ffffff', border: '#bfc1b7', mutedText: '#374151' },
      })
      expect(draft.tokens).toEqual({
        card: '#ffffff',
        border: '#bfc1b7',
        mutedForeground: '#374151',
      })
    })

    it('drops a role that would not read, or that is a colour rather than a neutral', () => {
      const draft = mapBrandRead({
        page: {
          background: '#ffffff',
          text: '#111111',
          card: '#fde0f0',
          border: '#f7f7f7',
          mutedText: '#b0b0b0',
        },
      })
      expect(draft.tokens).toBeUndefined()
    })

    it('keeps a dark mode with readable text, and its main colour when it shows on the dark page', () => {
      const draft = mapBrandRead({
        page: { background: '#ffffff' },
        dark: {
          page: { background: '#1d1f27', text: '#fafafa', card: '#2d2e37', border: '#3e424f' },
          buttonFill: '#f54e00',
        },
      })
      expect(draft.darkMode).toEqual({
        background: '#1d1f27',
        foreground: '#fafafa',
        primary: '#f54e00',
        card: '#2d2e37',
        border: '#3e424f',
      })
    })

    it('keeps a header bar with a colour of its own, not one that is the page', () => {
      const page = { background: '#ffffff' as const, text: '#212b32' as const }
      expect(mapBrandRead({ page: { ...page, header: '#005eb8' } }).tokens).toEqual({
        header: '#005eb8',
      })
      expect(mapBrandRead({ page: { ...page, header: '#f8f8f8' } }).tokens).toBeUndefined()
      expect(mapBrandRead({ page: { ...page, header: '#ffffff' } }).tokens).toBeUndefined()
    })

    it('keeps quieter text only when it is clearly quieter than the main text', () => {
      const page = { background: '#ffffff' as const, text: '#0a0a0a' as const }
      expect(mapBrandRead({ page: { ...page, mutedText: '#262626' } }).tokens).toBeUndefined()
      // Readable on the page, but not on the quiet fill beside it.
      expect(mapBrandRead({ page: { ...page, mutedText: '#64748d' } }).tokens).toBeUndefined()
      expect(mapBrandRead({ page: { ...page, mutedText: '#5b616e' } }).tokens).toEqual({
        mutedForeground: '#5b616e',
      })
    })

    it('takes a dark mode’s text only when it is close to white, else the automatic one', () => {
      const draft = mapBrandRead({
        page: { background: '#fafafa' },
        dark: { page: { background: '#000000', text: '#a1a1a1' } },
      })
      expect(draft.darkMode).toEqual({ background: '#000000' })
    })

    it('reads no dark mode when the dark page’s text cannot be read on it', () => {
      // A dark-scheme rule that darkens a fill and leaves the words dark is not a dark mode.
      const unread = mapBrandRead({
        page: { background: '#ffffff', text: '#222222' },
        dark: { page: { background: '#111111', text: '#333333' } },
      })
      expect(unread.darkMode).toBeUndefined()
      const unmeasured = mapBrandRead({
        page: { background: '#ffffff', text: '#222222' },
        dark: { page: { background: '#111111' } },
      })
      expect(unmeasured.darkMode).toBeUndefined()
    })

    it('reads a dark mode whose leading words are a colour that still shows on the dark page', () => {
      // A news site's dark page under orange link words: a dark mode, its text left automatic.
      const draft = mapBrandRead({
        page: { background: '#f1efed', text: '#5c5a58' },
        dark: { page: { background: '#000000', text: '#d03d12' } },
      })
      expect(draft.darkMode).toEqual({ background: '#000000' })
    })

    it('reads no dark mode when the dark-scheme page stays light', () => {
      const draft = mapBrandRead({
        page: { background: '#ffffff', text: '#222222' },
        dark: { page: { background: '#f4f4f4', text: '#222222' } },
      })
      expect(draft.darkMode).toBeUndefined()
    })

    it('reads no dark mode for a site that is dark already', () => {
      const draft = mapBrandRead({
        page: { background: '#121212' },
        dark: { page: { background: '#000000', text: '#ffffff' } },
      })
      expect(draft.darkMode).toBeUndefined()
    })
  })

  it('takes the brand colour from a logo file drawn mostly in one hue, when no button gives one', () => {
    // A country picker page with no call to action, and the logo as an image file.
    const ikea =
      '<svg viewBox="0 0 98 40"><path fill="#0058a3" d="M0 0h98v40H0z"/><path fill="#ffdb00" d="M2 20c0 10 20 18 47 18S96 30 96 20 77 2 49 2 2 10 2 20Z"/><path fill="#0058ab" d="M46 25h-9z"/></svg>'
    const draft = mapBrandRead({
      page: { background: '#fffefb' },
      logo: { svg: ikea, widthPx: 89, heightPx: 36, from: 'header-img' },
    })
    expect(draft.primary).toBe('#0058a3')
    // A logo of many hues names none.
    const many =
      '<svg><path fill="#f24e1e"/><path fill="#a259ff"/><path fill="#1abcfe"/><path fill="#0acf83"/></svg>'
    expect(
      mapBrandRead({
        page: { background: '#ffffff' },
        logo: { svg: many, widthPx: 30, heightPx: 45, from: 'header-svg' },
      }).primary
    ).toBeUndefined()
  })

  it('never takes the page colour itself for the main colour', () => {
    const dark: BrandRead = { page: { background: '#08090a' }, themeColor: '#08090a' }
    expect(mapBrandRead(dark).primary).toBeUndefined()
    expect(mapBrandRead(dark).missing).toContain('colour')
    expect(
      mapBrandRead({
        page: { background: '#ffffff' },
        button: { fill: '#ffffff' },
        themeColor: '#0a7f4f',
      }).primary
    ).toBe('#0a7f4f')
  })

  it('takes the most saturated of the strongest palette colours, not a pale tint of it', () => {
    const ramp = ['#d6d9fc', '#b9b9f9', '#665efd', '#533afd', '#2e2b8c', '#161741'].map((hex) => ({
      hex: hex as `#${string}`,
      share: 0.15,
    }))
    expect(
      mapBrandRead({ ...base, palette: [...ramp, { hex: '#ff5600', share: 0.1 }] }).primary
    ).toBe('#533afd')
    // Only pale tints: no main colour rather than a wrong one.
    expect(mapBrandRead({ ...base, palette: [{ hex: '#e6f3fe', share: 1 }] }).missing).toContain(
      'colour'
    )
  })

  it('keeps a page text colour only when it reads well and is not the automatic one', () => {
    expect(mapBrandRead({ page: { background: '#ffffff', text: '#1d3557' } }).text).toBe('#1d3557')
    expect(mapBrandRead({ page: { background: '#ffffff', text: '#0b0b0b' } }).text).toBeUndefined()
    // Too faint to read: left automatic.
    expect(mapBrandRead({ page: { background: '#ffffff', text: '#bbbbbb' } }).text).toBeUndefined()
  })

  it('reads a transparent page as white, and says when no page colour was read', () => {
    expect(mapBrandRead({ page: { background: 'transparent' } })).toMatchObject({
      background: '#ffffff',
      scheme: 'light',
    })
    const draft = mapBrandRead({})
    expect(draft.background).toBeUndefined()
    expect(draft.scheme).toBeUndefined()
    expect(draft.missing).toEqual(['logo', 'colour', 'page', 'font', 'shape'])
  })

  it('reads a pill from a percentage or a radius of half the height, and never takes corners from one', () => {
    expect(mapBrandRead({ button: { radiusPx: 20, heightPx: 42 } })).toMatchObject({
      buttonShape: 'pill',
      radius: 0.5,
    })
    expect(mapBrandRead({ button: { radiusPercent: 50 } }).buttonShape).toBe('pill')
    expect(mapBrandRead({ button: { radiusPx: 6, heightPx: 40 } })).toMatchObject({
      buttonShape: 'corners',
      buttonPx: 6,
      radius: 0.25,
    })
  })

  it('takes the corner radius from a card when one was measured', () => {
    expect(
      mapBrandRead({ button: { radiusPx: 4, heightPx: 40 }, card: { radiusPx: 14 } }).radius
    ).toBe(1)
    expect(mapBrandRead({ card: { radiusPx: 0 } }).radius).toBe(0)
  })

  it('names a wordmark wide and anything squarer square', () => {
    expect(mapBrandRead({ logo: { widthPx: 110, heightPx: 50, from: 'header-svg' } }).logo).toEqual(
      {
        kind: 'wide',
      }
    )
    expect(mapBrandRead({ logo: { widthPx: 100, heightPx: 50, from: 'header-img' } }).logo).toEqual(
      {
        kind: 'square',
      }
    )
    expect(mapBrandRead({ logo: { widthPx: 300, heightPx: 50, from: 'icon' } }).logo).toEqual({
      kind: 'square',
    })
  })
})

describe('mapBrandRead fonts', () => {
  const font = (body: string, headline?: string) =>
    mapBrandRead({
      fonts: {
        body: { family: body.split(',')[0], stack: body },
        headline: headline ? { family: headline.split(',')[0], stack: headline } : undefined,
      },
    }).font

  it('matches a family the portal offers exactly', () => {
    expect(font('"DM Sans", sans-serif')).toEqual({ site: 'DM Sans', id: 'dm-sans', exact: true })
    expect(font('Lora, Georgia, serif')).toEqual({ site: 'Lora', id: 'lora', exact: true })
  })

  it('never takes a generic name for the system font', () => {
    expect(font('"Acme Grotesk", system-ui, sans-serif')).toEqual({
      site: 'Acme Grotesk',
      id: 'inter',
      exact: false,
    })
  })

  it('reads the system font as itself when the page names nothing else', () => {
    expect(font('system-ui, -apple-system, sans-serif')).toEqual({ id: 'system', exact: true })
  })

  it('falls back by the kind of face', () => {
    expect(font('"Acme Text", Georgia, serif')).toMatchObject({ id: 'lora', exact: false })
    expect(font('"Acme Code", monospace')).toMatchObject({ id: 'jetbrains', exact: false })
  })

  it('maps well-known faces by class', () => {
    expect(font('Futura PT, sans-serif')).toMatchObject({ id: 'dm-sans', exact: false })
    expect(font('Helvetica Neue, Arial, sans-serif')).toMatchObject({ id: 'inter', exact: false })
    expect(font('Gill Sans, sans-serif')).toMatchObject({ id: 'open-sans', exact: false })
    expect(font('VAG Rounded, sans-serif')).toMatchObject({ id: 'nunito', exact: false })
    expect(font('Didot, serif')).toMatchObject({ id: 'playfair', exact: false })
    expect(font('Menlo, monospace')).toMatchObject({ id: 'jetbrains', exact: false })
  })

  it('never takes the system stack after a brand face as the brand’s own fallback', () => {
    // Roboto here is the operating system's face, listed for Android, not a design choice.
    expect(
      font('"Charlie Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif')
    ).toMatchObject({ site: 'Charlie Text', exact: false, id: 'inter' })
    expect(
      font('"Airbnb Cereal VF", Circular, -apple-system, BlinkMacSystemFont, Roboto, sans-serif')
    ).toMatchObject({ site: 'Airbnb Cereal', id: 'dm-sans' })
    // A fallback the site chose before any system names still counts.
    expect(font('"Acme Sans", Lato, -apple-system, Roboto, sans-serif')).toMatchObject({
      id: 'lato',
    })
  })

  it('reads a stack that starts with the system font as the system font', () => {
    expect(font('-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif')).toEqual({
      id: 'system',
      exact: true,
    })
  })

  it('skips currency and emoji faces at the head of a stack', () => {
    expect(font('"Some Rial", "Apple Color Emoji", Lato, sans-serif')).toEqual({
      site: 'Lato',
      id: 'lato',
      exact: true,
    })
  })

  it('reads a family named with a build hash or one weight as the family itself', () => {
    expect(font('"Inter 5486e50ce5a4efdf", sans-serif')).toEqual({
      site: 'Inter',
      id: 'inter',
      exact: true,
    })
    expect(font('"Northwind Sans Regular", sans-serif')).toMatchObject({
      site: 'Northwind Sans',
      exact: false,
    })
  })

  it('spells the family as the copied font’s own file does', () => {
    const draft = mapBrandRead({
      fonts: {
        body: { family: 'Abcgintonorthwind', stack: 'Abcgintonorthwind, sans-serif' },
        headline: { family: 'northwinddisplay', stack: 'northwinddisplay, serif' },
      },
      siteFont: { family: 'ABC Ginto Northwind', licence: 'commercial', files: [] },
      siteHeadingFont: { family: 'Northwind Display', notCopied: 'subset' },
    })
    expect(draft.font.site).toBe('ABC Ginto Northwind')
    expect(draft.headings).toEqual({ site: 'Northwind Display' })
    // A body in the system font takes the headings' family for the text: its file spells it.
    const fromHeadline = mapBrandRead({
      fonts: {
        body: { family: 'system-ui', stack: 'system-ui, sans-serif' },
        headline: { family: 'northwinddisplay', stack: 'northwinddisplay, serif' },
      },
      siteHeadingFont: { family: 'Northwind Display', licence: 'commercial', files: [] },
    })
    expect(fromHeadline.font.site).toBe('Northwind Display')
  })

  it('takes the file’s name for a family the stylesheet names another way', () => {
    const draft = mapBrandRead({
      fonts: {
        body: { family: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
        headline: { family: 'northwindregular', stack: 'northwindregular, Arial, sans-serif' },
      },
      siteHeadingFont: {
        family: 'Northwind',
        named: 'northwindregular',
        licence: 'commercial',
        files: [],
      },
    })
    expect(draft.headings).toEqual({ site: 'Northwind' })
  })

  it('offers no headings font when the headings are the text’s family under the file’s name', () => {
    const stack = 'NorthSansforNW, Arial, sans-serif'
    const draft = mapBrandRead({
      fonts: {
        body: { family: 'NorthSansforNW', stack },
        headline: { family: 'NorthSansforNW', stack },
      },
      siteFont: {
        family: 'North Sans Nova for NW',
        named: 'NorthSansforNW',
        licence: 'commercial',
        files: [],
      },
    })
    expect(draft.font.site).toBe('North Sans Nova for NW')
    expect(draft.headings).toBeUndefined()
  })

  it('marks a headings face the site draws only large as one for page headings', () => {
    const fonts = (minPx?: number) => ({
      body: { family: 'Harbor Sans', stack: 'Harbor Sans, sans-serif' },
      headline: {
        family: 'Northwind Display',
        stack: 'Northwind Display, serif',
        ...(minPx === undefined ? {} : { minPx }),
      },
    })
    expect(mapBrandRead({ fonts: fonts(48) }).headings).toEqual({
      site: 'Northwind Display',
      display: true,
    })
    // Drawn small somewhere, or not measured: a headings font for every title.
    expect(mapBrandRead({ fonts: fonts(14) }).headings).toEqual({ site: 'Northwind Display' })
    expect(mapBrandRead({ fonts: fonts() }).headings).toEqual({ site: 'Northwind Display' })
  })

  it('passes over an emoji, flag or icon face at the head of a stack', () => {
    const stack = '"Twemoji Country Flags", Gellix, Arial, sans-serif, "Apple Color Emoji"'
    expect(
      mapBrandRead({ fonts: { body: { family: 'Twemoji Country Flags', stack } } }).font
    ).toMatchObject({ site: 'Gellix' })
    expect(
      mapBrandRead({
        fonts: { body: { family: 'Font Awesome 6 Free', stack: '"Font Awesome 6 Free", Lato' } },
      }).font
    ).toMatchObject({ site: 'Lato', id: 'lato', exact: true })
  })

  it('says the font is missing when none was read', () => {
    expect(mapBrandRead({}).font).toEqual({ id: 'inter', exact: false })
  })
})

describe('the headings font', () => {
  const read = (body: string, headline: string | undefined): BrandRead => ({
    fonts: {
      body: { family: body.split(',')[0]!, stack: body },
      ...(headline ? { headline: { family: headline.split(',')[0]!, stack: headline } } : {}),
    },
  })
  const headings = (body: string, headline: string | undefined) =>
    mapBrandRead(read(body, headline)).headings

  it('is a portal font when the site sets its headings in one the portal has', () => {
    expect(
      headings('Inter, "Inter Fallback", sans-serif', '"Plus Jakarta Sans", system-ui, sans-serif')
    ).toEqual({ site: 'Plus Jakarta Sans', id: 'jakarta' })
    expect(headings('Inter, sans-serif', 'Manrope, "Manrope Fallback", system-ui')).toEqual({
      site: 'Manrope',
      id: 'manrope',
    })
  })

  it('is the site’s own family when the portal has none like it', () => {
    expect(headings('Inter, sans-serif', '"Northwind Display", Georgia, serif')).toEqual({
      site: 'Northwind Display',
    })
  })

  it('is skipped when the headings are another cut of the text font', () => {
    expect(headings('MonzoSansText, sans-serif', 'MonzoSansDisplay, sans-serif')).toBeUndefined()
    expect(headings('"Charlie Text", sans-serif', '"Charlie Display", sans-serif')).toBeUndefined()
    expect(headings('"Klarna Text", sans-serif', '"Klarna Title", sans-serif')).toBeUndefined()
  })

  it('is skipped when the headings are another weight of the text font', () => {
    expect(
      headings('"Avenir Next LTW02 Regular", sans-serif', '"Avenir Next LT W02 Bold", sans-serif')
    ).toBeUndefined()
    expect(
      headings('"Northwind Regular", sans-serif', '"Northwind Bold", sans-serif')
    ).toBeUndefined()
  })

  it('is skipped when the headings are set in the text font, or in the system font', () => {
    expect(headings('Inter, sans-serif', 'Inter, sans-serif')).toBeUndefined()
    expect(headings('sohne-var, sans-serif', 'Sohne, Helvetica')).toBeUndefined()
    expect(headings('Inter, sans-serif', undefined)).toBeUndefined()
    expect(headings('Inter, sans-serif', 'system-ui, sans-serif')).toBeUndefined()
  })

  it('is skipped when the text font was itself taken from the headings', () => {
    // A body set in the system font: the headline's family is the portal's text font.
    const draft = mapBrandRead(read('system-ui, sans-serif', 'Manrope, sans-serif'))
    expect(draft.font).toEqual({ site: 'Manrope', id: 'manrope', exact: true })
    expect(draft.headings).toBeUndefined()
  })

  it('needs a text font to stand beside', () => {
    expect(headingsOf(read('Inter, sans-serif', 'Manrope, sans-serif'), null)).toBeUndefined()
  })
})

describe('the card style, from the page’s cards', () => {
  it('is the look most words sit on, when the cards clearly agree', () => {
    expect(cardStyleOf({ border: 40, shadow: 900, flat: 0 })).toBe('shadow')
    expect(cardStyleOf({ border: 700, shadow: 100, flat: 100 })).toBe('border')
    expect(cardStyleOf({ border: 0, shadow: 0, flat: 300 })).toBe('flat')
  })

  it('is left alone when the cards are mixed', () => {
    expect(cardStyleOf({ border: 400, shadow: 500, flat: 0 })).toBeUndefined()
    expect(cardStyleOf({ border: 300, shadow: 300, flat: 300 })).toBeUndefined()
  })

  it('is left alone when too few words sit on cards to say', () => {
    expect(cardStyleOf({ border: 0, shadow: 60, flat: 0 })).toBeUndefined()
    expect(cardStyleOf({ border: 0, shadow: 0, flat: 0 })).toBeUndefined()
    expect(cardStyleOf(undefined)).toBeUndefined()
  })

  it('reaches the draft, and only when it is clear', () => {
    expect(mapBrandRead({ card: { looks: { border: 0, shadow: 500, flat: 20 } } }).cardStyle).toBe(
      'shadow'
    )
    expect(
      mapBrandRead({ card: { looks: { border: 200, shadow: 250, flat: 0 } } })
    ).not.toHaveProperty('cardStyle')
    expect(mapBrandRead({ card: { radiusPx: 8 } })).not.toHaveProperty('cardStyle')
  })
})
