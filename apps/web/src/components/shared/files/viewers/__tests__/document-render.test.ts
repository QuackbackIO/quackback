// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"disableJavaScriptFileLoading":true,"disableIframePageLoading":true,"handleDisabledFileLoadingAsSuccess":true}}
import './browser-dom'
import { describe, expect, it, vi } from 'vitest'
import DOMPurify from 'dompurify'
import {
  DOCUMENT_CSP,
  DOCUMENT_RENDER_OPTIONS,
  buildDocumentSrcdoc,
  inertElementFactory,
  pageWidthPx,
  renderDocumentHtml,
  sanitizeDocumentHtml,
  sanitizerWorks,
} from '../document-render'
import { docxFixture, toArrayBuffer } from './docx-fixture'

const HOSTILE = `
<style>.docx p { color: #222 }</style>
<p onclick="alert(1)">hello<img src="x" onerror="alert(1)"><img src="data:image/png;base64,iVBORw0KGgo="></p>
<a href="javascript:alert(1)">js link</a>
<a href="JaVaScRiPt:alert(1)">mixed case js</a>
<a href="https://ok.example/page">web link</a>
<a href="mailto:help@example.com">mail link</a>
<a href="#bookmark">fragment link</a>
<a href="//evil.example/x">protocol-relative link</a>
<iframe srcdoc="<script>alert(1)</script>"></iframe>
<object data="x.swf"></object><embed src="x.swf">
<form action="https://evil.example/collect"><input name="a"><button formaction="https://evil.example/b">go</button><textarea>t</textarea><select><option>o</option></select></form>
<script>alert(1)</script>
<svg><image href="https://evil.example/svg.png"></image><image href="data:image/png;base64,AAAA"></image><a href="javascript:alert(1)"><text>svg link</text></a></svg>
<base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"><link rel="stylesheet" href="https://evil.example/x.css">
<img src="https://evil.example/pixel.png" srcset="https://evil.example/2x.png 2x">
<video poster="https://evil.example/poster.png"></video>
<table background="https://evil.example/bg.png"><tr><td>cell</td></tr></table>
`

describe('sanitizeDocumentHtml', () => {
  const out = sanitizeDocumentHtml(HOSTILE)
  const doc = new DOMParser().parseFromString(`<body>${out}</body>`, 'text/html')

  it('keeps the document text and its styles', () => {
    expect(doc.body.textContent).toContain('hello')
    expect(doc.body.textContent).toContain('cell')
    expect(doc.querySelector('style')?.textContent).toContain('.docx p')
  })

  it('removes scripts, event handlers and every embedding or form element', () => {
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/\son\w+=/i)
    for (const tag of [
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'button',
      'textarea',
      'select',
      'base',
      'meta',
      'link',
    ]) {
      expect(doc.querySelector(tag), tag).toBeNull()
    }
  })

  it('keeps only web and mail links, opened outside the frame', () => {
    const links = Array.from(doc.querySelectorAll('a'))
    const hrefs = links.map((a) => a.getAttribute('href')).filter(Boolean)
    expect(hrefs.sort()).toEqual(['https://ok.example/page', 'mailto:help@example.com'])
    for (const a of links.filter((l) => l.hasAttribute('href'))) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    }
    expect(out).not.toMatch(/javascript:/i)
    expect(doc.body.textContent).toContain('js link')
  })

  it('keeps only embedded images, never a remote one', () => {
    const sources = Array.from(doc.querySelectorAll('img, image')).map(
      (el) => el.getAttribute('src') ?? el.getAttribute('href')
    )
    expect(sources.filter(Boolean).every((s) => s!.startsWith('data:'))).toBe(true)
    expect(sources.filter(Boolean)).toHaveLength(2)
    expect(out).not.toContain('evil.example')
    // An image that only linked out is hidden rather than drawn as a broken frame.
    for (const img of Array.from(doc.querySelectorAll('img, image'))) {
      const embedded = (img.getAttribute('src') ?? img.getAttribute('href'))?.startsWith('data:')
      expect(img.hasAttribute('hidden')).toBe(!embedded)
    }
  })
})

describe('sanitizerWorks', () => {
  it('accepts a sanitizer that strips the canary', () => {
    expect(sanitizerWorks(DOMPurify(window))).toBe(true)
  })

  it('refuses one that hands its input back, as DOMPurify does when it cannot run', () => {
    const passThrough = { isSupported: true, sanitize: (html: string) => html }
    expect(sanitizerWorks(passThrough as never)).toBe(false)
    expect(sanitizerWorks({ ...DOMPurify(window), isSupported: false } as never)).toBe(false)
  })
})

describe('buildDocumentSrcdoc', () => {
  const srcdoc = buildDocumentSrcdoc('<p>Body text</p>', { zoom: 1.5, dark: false })

  it('opens with the strict content security policy, before any content', () => {
    expect(DOCUMENT_CSP).toBe(
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"
    )
    const meta = `<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_CSP}">`
    expect(srcdoc).toContain(meta)
    expect(srcdoc.indexOf(meta)).toBeLessThan(srcdoc.indexOf('<style'))
    expect(srcdoc.indexOf(meta)).toBeLessThan(srcdoc.indexOf('Body text'))
  })

  it('carries the body and the zoom, and no script', () => {
    expect(srcdoc).toContain('<p>Body text</p>')
    expect(srcdoc).toMatch(/zoom:\s*1\.5/)
    expect(srcdoc).not.toMatch(/<script/i)
  })

  it('puts white pages on a desk that follows the app theme', () => {
    const light = buildDocumentSrcdoc('', { zoom: 1, dark: false })
    const dark = buildDocumentSrcdoc('', { zoom: 1, dark: true })
    expect(light).not.toBe(dark)
    expect(light).toMatch(/section\.docx[^}]*background:\s*#fff/)
    expect(dark).toMatch(/section\.docx[^}]*background:\s*#fff/)
  })
})

describe('pageWidthPx', () => {
  it('converts the page widths Word documents use to CSS pixels', () => {
    expect(pageWidthPx('612.00pt')).toBe(816)
    expect(pageWidthPx('8.5in')).toBe(816)
    expect(pageWidthPx('816px')).toBe(816)
    expect(pageWidthPx('21cm')).toBeCloseTo(793.7, 1)
  })

  it('is null for anything else', () => {
    expect(pageWidthPx('')).toBeNull()
    expect(pageWidthPx('auto')).toBeNull()
    expect(pageWidthPx('50%')).toBeNull()
  })
})

describe('DOCUMENT_RENDER_OPTIONS', () => {
  it('turns off the renderer defaults that load or embed content', () => {
    expect(DOCUMENT_RENDER_OPTIONS).toMatchObject({
      renderAltChunks: false,
      useBase64URL: true,
      experimental: false,
      ignoreFonts: true,
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
    })
  })
})

describe('inertElementFactory', () => {
  it('builds every node in the given document, as docx-preview would in the page', () => {
    const inert = document.implementation.createHTMLDocument('')
    const h = inertElementFactory(inert)
    const link = h({
      tagName: 'a',
      className: 'docx-link',
      style: { color: 'red' },
      href: 'https://example.com/',
      children: ['Docs', { tagName: 'img', src: 'data:image/png;base64,AAAA' }],
    }) as HTMLAnchorElement
    expect(link.ownerDocument).toBe(inert)
    expect(link.getAttribute('class')).toBe('docx-link')
    expect(link.style.color).toBe('red')
    expect(link.getAttribute('href')).toBe('https://example.com/')
    expect(link.textContent).toBe('Docs')
    expect(link.querySelector('img')?.ownerDocument).toBe(inert)

    const svg = h({ ns: 'http://www.w3.org/2000/svg', tagName: 'svg', style: 'width:1px' })
    expect((svg as Element).namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect((svg as Element).getAttribute('style')).toBe('width:1px')

    const fragment = h({ tagName: '#fragment', children: ['a', { tagName: 'b' }] })
    expect(fragment.childNodes).toHaveLength(2)
    expect(h({ tagName: '#comment', children: ['note'] }).nodeType).toBe(Node.COMMENT_NODE)
  })
})

describe('renderDocumentHtml', () => {
  it('never builds the document’s elements in the live page', async () => {
    const created = vi.spyOn(document, 'createElement')
    try {
      await renderDocumentHtml(toArrayBuffer(docxFixture()))
      const tags = created.mock.calls.map(([tag]) => String(tag).toLowerCase())
      expect(tags).not.toContain('img')
      expect(tags).not.toContain('section')
      expect(tags).not.toContain('a')
    } finally {
      created.mockRestore()
    }
  })

  it('renders a real document to sanitized HTML with its hostile parts gone', async () => {
    const { html, pageWidthPx: width } = await renderDocumentHtml(toArrayBuffer(docxFixture()))
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')

    expect(doc.body.textContent).toContain('Quarterly plan')
    expect(doc.body.textContent).toContain('Click me')
    expect(doc.querySelector('section.docx')).not.toBeNull()
    expect(doc.querySelector('style')).not.toBeNull()

    const web = Array.from(doc.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('Read the docs')
    )
    expect(web?.getAttribute('href')).toBe('https://example.com/docs')
    expect(web?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(html).not.toMatch(/javascript:/i)

    const images = Array.from(doc.querySelectorAll('img')).map((i) => i.getAttribute('src'))
    expect(images.some((s) => s?.startsWith('data:image/png;base64,'))).toBe(true)
    expect(html).not.toContain('tracker.example')

    expect(html).not.toContain('alt chunk')
    expect(doc.querySelector('iframe, script')).toBeNull()

    expect(width).toBe(816)
  })
})
