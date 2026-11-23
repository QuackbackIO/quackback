import { describe, expect, it } from 'vitest'
import { parseFontFaces, pickSiteFont, type PageFontFace } from '../font-faces'

const face = (over: Partial<PageFontFace> = {}): PageFontFace => ({
  family: 'Calibre',
  weight: '400',
  style: 'normal',
  src: [{ url: 'https://northwind.com/fonts/calibre-400.woff2', format: 'woff2' }],
  ...over,
})
const at = (name: string, format = 'woff2') => [
  { url: `https://northwind.com/fonts/${name}.${format}`, format },
]

describe('pickSiteFont', () => {
  it('takes the regular and the bold of the family the text is set in', () => {
    const faces = [
      face({ weight: '300', src: at('light') }),
      face({ weight: '400', src: at('regular') }),
      face({ weight: '400', style: 'italic', src: at('italic') }),
      face({ weight: '500', src: at('medium') }),
      face({ weight: '700', src: at('bold') }),
      face({ family: 'Other', src: at('other') }),
    ]
    expect(pickSiteFont('"Calibre", Helvetica, sans-serif', faces)).toEqual({
      family: 'Calibre',
      service: false,
      picks: [
        { url: 'https://northwind.com/fonts/regular.woff2', weight: 400 },
        { url: 'https://northwind.com/fonts/bold.woff2', weight: 700 },
      ],
    })
  })

  it('takes 600 as the bold when there is no 700, and the regular alone when there is neither', () => {
    const regular = face({ src: at('regular') })
    expect(
      pickSiteFont('Calibre', [regular, face({ weight: '600', src: at('semi') })])?.picks
    ).toEqual([
      { url: 'https://northwind.com/fonts/regular.woff2', weight: 400 },
      { url: 'https://northwind.com/fonts/semi.woff2', weight: 600 },
    ])
    expect(pickSiteFont('Calibre', [regular])?.picks).toHaveLength(1)
  })

  it('takes one file for a variable font, with the weights it covers', () => {
    expect(
      pickSiteFont('sohne-var, Helvetica', [
        face({ family: 'sohne-var', weight: '1 1000', src: at('var') }),
      ])
    ).toEqual({
      family: 'sohne-var',
      service: false,
      picks: [{ url: 'https://northwind.com/fonts/var.woff2', weight: 100, weightTo: 900 }],
    })
  })

  it('reads the keywords normal and bold, and matches a family whatever its case or quotes', () => {
    const picks = pickSiteFont("'calibre'", [
      face({ weight: 'normal', src: at('r') }),
      face({ weight: 'bold', src: at('b') }),
    ])?.picks
    expect(picks?.map((pick) => pick.weight)).toEqual([400, 700])
  })

  it('takes the Latin file of a font split by character range', () => {
    const faces = [
      face({ src: at('cyrillic'), range: 'U+0400-045F, U+0490-0491' }),
      face({ src: at('latin-ext'), range: 'U+0100-02AF, U+1E00-1EFF' }),
      face({ src: at('latin'), range: 'U+0000-00FF, U+0131, U+0152-0153' }),
      face({ src: at('wild'), range: 'U+4??' }),
    ]
    expect(pickSiteFont('Calibre', faces)?.picks).toEqual([
      { url: 'https://northwind.com/fonts/latin.woff2', weight: 400 },
    ])
  })

  it('takes the file the browser loaded where several rules give one weight, else the last', () => {
    const faces = [
      face({ src: at('greek') }),
      face({ src: at('latin') }),
      face({ src: at('thai') }),
    ]
    expect(
      pickSiteFont('Calibre', faces, new Set(['https://northwind.com/fonts/latin.woff2']))?.picks
    ).toEqual([{ url: 'https://northwind.com/fonts/latin.woff2', weight: 400 }])
    expect(pickSiteFont('Calibre', faces)?.picks[0]?.url).toBe(
      'https://northwind.com/fonts/thai.woff2'
    )
  })

  it('prefers WOFF2, then WOFF, then TTF or OTF, by format or by extension', () => {
    const src = [
      { url: 'https://northwind.com/f/c.eot' },
      { url: 'https://northwind.com/f/c.ttf', format: 'truetype' },
      { url: 'https://northwind.com/f/c.woff' },
      { url: 'https://northwind.com/f/c?v=2', format: 'woff2' },
    ]
    expect(pickSiteFont('Calibre', [face({ src })])?.picks[0]?.url).toBe(
      'https://northwind.com/f/c?v=2'
    )
    expect(pickSiteFont('Calibre', [face({ src: src.slice(0, 3) })])?.picks[0]?.url).toBe(
      'https://northwind.com/f/c.woff'
    )
    expect(pickSiteFont('Calibre', [face({ src: src.slice(0, 1) })])?.picks).toEqual([])
  })

  it('names a font service and takes none of its files', () => {
    const faces = [
      face({ src: [{ url: 'https://use.typekit.net/af/1/l?fvd=n4', format: 'woff2' }] }),
      face({ weight: '700', src: [{ url: 'https://use.typekit.net/af/2/l?fvd=n7' }] }),
    ]
    expect(pickSiteFont('Calibre, sans-serif', faces)).toEqual({
      family: 'Calibre',
      service: true,
      picks: [],
    })
  })

  it('has nothing for text set in a system font, or in a family the page declares no file for', () => {
    expect(pickSiteFont('-apple-system, BlinkMacSystemFont, "Segoe UI"', [face()])).toBeNull()
    expect(pickSiteFont('Helvetica Neue, Arial, sans-serif', [face()])).toBeNull()
    expect(pickSiteFont('', [face()])).toBeNull()
  })

  it('passes over an emoji, flag or icon face at the head of the stack, files or not', () => {
    const faces = [
      face({ family: 'Twemoji Country Flags', src: at('flags'), range: 'U+1F1E6-1F1FF' }),
      face({ family: 'Gellix', src: at('gellix') }),
    ]
    expect(pickSiteFont('"Twemoji Country Flags", Gellix, Arial, sans-serif', faces)).toMatchObject(
      { family: 'Gellix', picks: [{ url: 'https://northwind.com/fonts/gellix.woff2' }] }
    )
  })

  it('takes the first family the page has files for, past an installed copy named before it', () => {
    const faces = [face({ family: 'adobe-clean' }), face({ family: 'Other', src: at('other') })]
    expect(pickSiteFont('"Adobe Clean", adobe-clean, Other, sans-serif', faces)?.family).toBe(
      'adobe-clean'
    )
  })

  it('never takes an inline or non-web address', () => {
    expect(
      pickSiteFont('Calibre', [face({ src: [{ url: 'data:font/woff2;base64,AAAA' }] })])?.picks
    ).toEqual([])
  })
})

describe('parseFontFaces', () => {
  it('reads each @font-face of a stylesheet, its addresses made absolute', () => {
    const css = `
      /* a comment with @font-face { in it } */
      @font-face{font-family:"Calibre";font-weight:400;font-style:normal;
        src:url(../fonts/calibre.woff2) format("woff2"),url('/fonts/calibre.woff') format('woff');
        unicode-range:U+0000-00FF,U+0131}
      body { color: red }
      @media (min-width: 1px) { @font-face { font-family: Calibre; font-weight: 100 900;
        src: url("https://cdn.northwind.com/c-var.woff2") format("woff2-variations") } }`
    expect(parseFontFaces(css, 'https://northwind.com/static/css/site.css')).toEqual([
      {
        family: 'Calibre',
        weight: '400',
        style: 'normal',
        range: 'U+0000-00FF,U+0131',
        src: [
          { url: 'https://northwind.com/static/fonts/calibre.woff2', format: 'woff2' },
          { url: 'https://northwind.com/fonts/calibre.woff', format: 'woff' },
        ],
      },
      {
        family: 'Calibre',
        weight: '100 900',
        style: 'normal',
        src: [{ url: 'https://cdn.northwind.com/c-var.woff2', format: 'woff2-variations' }],
      },
    ])
  })

  it('reads every src of a rule that gives an old format first', () => {
    const css = `@font-face{font-family:futura-pt;src:url(f.eot);src:url(f.eot?#iefix) format("embedded-opentype"),url(f.woff2) format("woff2");font-weight:normal}`
    const [parsed] = parseFontFaces(css, 'https://cdn.northwind.com/css/site.css')
    expect(parsed!.src.map((source) => source.url)).toEqual([
      'https://cdn.northwind.com/css/f.eot',
      'https://cdn.northwind.com/css/f.eot?#iefix',
      'https://cdn.northwind.com/css/f.woff2',
    ])
    expect(pickSiteFont('futura-pt', [parsed!])?.picks).toEqual([
      { url: 'https://cdn.northwind.com/css/f.woff2', weight: 400 },
    ])
  })

  it('reads nothing from text that is not a stylesheet, and stops at a cap', () => {
    expect(parseFontFaces('<html>', 'https://northwind.com/')).toEqual([])
    const many = '@font-face{font-family:A;src:url(a.woff2)}'.repeat(500)
    expect(parseFontFaces(many, 'https://northwind.com/').length).toBeLessThanOrEqual(200)
  })
})

describe('pickSiteFont for headings', () => {
  it('takes the semibold and the bold, the weights headings are set in', () => {
    const faces = [
      face({ weight: '400', src: at('regular') }),
      face({ weight: '500', src: at('medium') }),
      face({ weight: '600', src: at('semi') }),
      face({ weight: '700', src: at('bold') }),
      face({ weight: '900', src: at('black') }),
    ]
    expect(pickSiteFont('Calibre, serif', faces, new Set(), 'headings')?.picks).toEqual([
      { url: 'https://northwind.com/fonts/semi.woff2', weight: 600 },
      { url: 'https://northwind.com/fonts/bold.woff2', weight: 700 },
    ])
  })

  it('takes the one file of a variable font', () => {
    const picks = pickSiteFont(
      'Calibre',
      [face({ weight: '100 900', src: at('var') })],
      new Set(),
      'headings'
    )?.picks
    expect(picks).toEqual([
      { url: 'https://northwind.com/fonts/var.woff2', weight: 100, weightTo: 900 },
    ])
  })

  it('takes the bold alone when there is no semibold, and never the regular beside one', () => {
    const faces = [
      face({ weight: '400', src: at('regular') }),
      face({ weight: '700', src: at('bold') }),
    ]
    expect(pickSiteFont('Calibre', faces, new Set(), 'headings')?.picks).toEqual([
      { url: 'https://northwind.com/fonts/bold.woff2', weight: 700 },
    ])
  })

  it('takes the heaviest cut a display face has when it has no semibold or bold', () => {
    const faces = [
      face({ weight: '300', src: at('light') }),
      face({ weight: '500', src: at('medium') }),
    ]
    expect(pickSiteFont('Calibre', faces, new Set(), 'headings')?.picks).toEqual([
      { url: 'https://northwind.com/fonts/medium.woff2', weight: 500 },
    ])
    expect(
      pickSiteFont('Calibre', [face({ src: at('regular') })], new Set(), 'headings')?.picks
    ).toEqual([{ url: 'https://northwind.com/fonts/regular.woff2', weight: 400 }])
  })

  it('still names a font service’s family and takes nothing', () => {
    const typekit = face({ weight: '700', src: [{ url: 'https://use.typekit.net/af/x.woff2' }] })
    expect(pickSiteFont('Calibre', [typekit], new Set(), 'headings')).toEqual({
      family: 'Calibre',
      service: true,
      picks: [],
    })
  })
})
