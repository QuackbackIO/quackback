import { describe, expect, it } from 'vitest'
import { isFontServiceUrl } from '../font-services'

describe('isFontServiceUrl', () => {
  it.each([
    'https://use.typekit.net/af/abc/000/l?primer=x&fvd=n4&v=3',
    'https://p.typekit.net/p.css',
    'https://fonts.adobe.com/x.woff2',
    'https://fast.fonts.net/dv2/14/x.woff2',
    'https://hello.fonts.com/x.woff2',
    'https://cloud.typography.com/123/456/css/fonts.css',
    'https://fonts.typotheque.com/WF-1.woff2',
    'https://webfonts.fontstand.com/WF-1.woff2',
    'HTTPS://USE.TYPEKIT.NET/x.woff2',
  ])('%s is a font service’s', (url) => expect(isFontServiceUrl(url)).toBe(true))

  it.each([
    'https://northwind.com/fonts/calibre.woff2',
    'https://notfonts.com/x.woff2',
    'https://myfonts.com.evil.example/x.woff2',
    'https://typekit.net.example.com/x.woff2',
    'https://fonts.gstatic.com/s/inter/v1/x.woff2',
    'not a url',
  ])('%s is not', (url) => expect(isFontServiceUrl(url)).toBe(false))
})
