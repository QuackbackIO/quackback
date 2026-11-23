// @vitest-environment happy-dom
/**
 * Listing a rendered page's @font-face rules: only the families the text
 * names, each address made absolute, rules inside @media included.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { listPageFonts } from '../page-fonts'

afterEach(() => {
  document.head.innerHTML = ''
})

describe('listPageFonts', () => {
  it('lists the rules of the families the stacks name, their addresses absolute', () => {
    document.head.innerHTML = `<style>
      @font-face { font-family: "Lato"; font-weight: 400; font-style: normal;
        src: url("/fonts/lato-400.woff2") format("woff2"), url(/fonts/lato-400.woff) format("woff");
        unicode-range: U+0000-00FF }
      @media (min-width: 1px) {
        @font-face { font-family: Lato; font-weight: 700; src: url(https://cdn.example/lato-700.woff2) }
      }
      @font-face { font-family: "Icons"; src: url(/fonts/icons.woff2) }
      @font-face { font-family: "Lato"; font-weight: 300; src: url(data:font/woff2;base64,AAAA) }
    </style>`
    const { fontFaces, fontSheets } = listPageFonts(['"lato", sans-serif', ''])
    expect(fontFaces.map((face) => [face.family, face.weight, face.style])).toEqual([
      ['Lato', '400', 'normal'],
      ['Lato', '700', 'normal'],
      ['Lato', '300', 'normal'],
    ])
    expect(fontFaces[0]!.src).toEqual([
      { url: new URL('/fonts/lato-400.woff2', document.baseURI).href, format: 'woff2' },
      { url: new URL('/fonts/lato-400.woff', document.baseURI).href, format: 'woff' },
    ])
    expect(fontFaces[1]!.src).toEqual([{ url: 'https://cdn.example/lato-700.woff2' }])
    // An inline file is no address to copy from.
    expect(fontFaces[2]!.src).toEqual([])
    expect(fontSheets).toEqual([])
  })

  it('lists nothing for a page with no rule for the text font', () => {
    document.head.innerHTML = '<style>body { color: red }</style>'
    expect(listPageFonts(['Lato, sans-serif'])).toEqual({ fontFaces: [], fontSheets: [] })
  })
})
