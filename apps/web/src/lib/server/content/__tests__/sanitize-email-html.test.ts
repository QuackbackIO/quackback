import { describe, it, expect } from 'vitest'
import { sanitizeEmailHtml } from '../sanitize-email-html'

describe('sanitizeEmailHtml', () => {
  it('returns empty string for empty input', () => {
    expect(sanitizeEmailHtml('')).toBe('')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeEmailHtml('   \n\t  ')).toBe('')
  })

  it('strips script tags along with their contents', () => {
    const out = sanitizeEmailHtml('<p>hi</p><script>alert(document.cookie)</script>')
    expect(out).toBe('<p>hi</p>')
    expect(out).not.toContain('alert')
  })

  it('strips style tags along with their contents', () => {
    const out = sanitizeEmailHtml('<style>.evil { color: red; }</style><p>hi</p>')
    expect(out).toBe('<p>hi</p>')
    expect(out).not.toContain('evil')
  })

  it('strips head/title/meta/link from a full HTML document, keeping only body content', () => {
    const doc =
      '<html><head><title>Sneaky Title</title><meta charset="utf-8">' +
      '<link rel="stylesheet" href="https://example.com/x.css"></head>' +
      '<body><p>hi</p></body></html>'
    const out = sanitizeEmailHtml(doc)
    expect(out).toBe('<p>hi</p>')
    expect(out).not.toContain('Sneaky Title')
  })

  it('strips iframe/object/embed/form/input/button tags along with their contents', () => {
    const out = sanitizeEmailHtml(
      '<p>hi</p>' +
        '<iframe src="https://evil.example">fallback text</iframe>' +
        '<object data="https://evil.example">object fallback</object>' +
        '<form><input type="text" value="x"><button>Click me</button></form>'
    )
    expect(out).toBe('<p>hi</p>')
  })

  it('drops onclick and style attributes', () => {
    const out = sanitizeEmailHtml('<p onclick="alert(1)" style="color:red">hi</p>')
    expect(out).toBe('<p>hi</p>')
  })

  it('removes javascript: hrefs but keeps the tag and its text', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">click me</a>')
    expect(out).toBe('<a>click me</a>')
  })

  it('removes vbscript: hrefs but keeps the tag and its text', () => {
    const out = sanitizeEmailHtml('<a href="vbscript:msgbox(1)">click me</a>')
    expect(out).toBe('<a>click me</a>')
  })

  it('removes data: image src but keeps the tag', () => {
    const out = sanitizeEmailHtml(
      '<img src="data:image/png;base64,AAAAAAAAAAAAAAAA" width="600" height="400">'
    )
    expect(out).toBe('<img width="600" height="400" />')
  })

  it('keeps cid: image src (attachment rewrite happens in a later task)', () => {
    const out = sanitizeEmailHtml('<img src="cid:part1.abc123@mail" width="600" height="400">')
    expect(out).toBe('<img src="cid:part1.abc123@mail" width="600" height="400" />')
  })

  it('removes protocol-relative hrefs and srcs (dodges the scheme allowlist otherwise)', () => {
    const hrefOut = sanitizeEmailHtml('<a href="//evil.example/x">click me</a>')
    expect(hrefOut).toBe('<a>click me</a>')

    const srcOut = sanitizeEmailHtml('<img src="//evil.example/x.png" width="600" height="400">')
    expect(srcOut).toBe('<img width="600" height="400" />')
  })

  it('preserves benign formatting byte-stable: bold, lists, blockquote, links', () => {
    const input =
      '<p>Hello <b>world</b>, <a href="https://example.com">link</a></p>' +
      '<ul><li>one</li><li>two</li></ul>' +
      '<blockquote>quoted</blockquote>'
    expect(sanitizeEmailHtml(input)).toBe(input)
  })

  it('preserves mailto links', () => {
    const input = '<p>Contact <a href="mailto:support@example.com">us</a></p>'
    expect(sanitizeEmailHtml(input)).toBe(input)
  })

  it('drops a 1x1 tracking pixel while keeping a real image', () => {
    const out = sanitizeEmailHtml(
      '<img src="https://track.example.com/open.gif" width="1" height="1">' +
        '<img src="https://example.com/photo.jpg" width="600" height="400">'
    )
    expect(out).toBe('<img src="https://example.com/photo.jpg" width="600" height="400" />')
  })

  it('drops a 2x2 tracking pixel too', () => {
    const out = sanitizeEmailHtml('<img src="https://track.example.com/open.gif" width="2" height="2">')
    expect(out).toBe('')
  })

  it('keeps an image missing one of width/height even if the other is small', () => {
    // Heuristic requires BOTH dims <= 2; a real image might only declare one.
    const out = sanitizeEmailHtml('<img src="https://example.com/tiny-but-real.png" height="2">')
    expect(out).toBe('<img src="https://example.com/tiny-but-real.png" height="2" />')
  })

  it('keeps h1-h6 tags as-is (conversion to paragraphs is a later step)', () => {
    const input = '<h1>Big Title</h1><h3>Subheading</h3><p>body</p>'
    expect(sanitizeEmailHtml(input)).toBe(input)
  })

  it('unwraps div/span, dropping the tag but keeping their content (no separator inserted)', () => {
    const out = sanitizeEmailHtml('<div dir="ltr">Hello <span style="color:red">world</span></div>')
    expect(out).toBe('Hello world')
  })

  it('preserves layout-table text content with no cell/row separators (pinned default behavior)', () => {
    const out = sanitizeEmailHtml(
      '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>'
    )
    expect(out).toBe('ABCD')
  })

  it('handles a real-world Gmail-style reply fixture without exploding', () => {
    const gmail =
      '<div dir="ltr">Thanks for the update!<div><br></div><div>See attached.</div>' +
      '<div class="gmail_quote">' +
      '<div dir="ltr" class="gmail_attr">On Mon, Jan 1, 2026 at 1:00 PM John &lt;' +
      '<a href="mailto:john@example.com">john@example.com</a>&gt; wrote:<br></div>' +
      '<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">' +
      '<div dir="ltr"><div>Original message body</div><div><br></div><div>- John</div></blockquote>' +
      '</div></div>'

    const out = sanitizeEmailHtml(gmail)

    expect(out).toBe(
      'Thanks for the update!<br />See attached.On Mon, Jan 1, 2026 at 1:00 PM John &lt;' +
        '<a href="mailto:john@example.com">john@example.com</a>&gt; wrote:<br />' +
        '<blockquote>Original message body<br />- John</blockquote>'
    )
  })

  it('does not explode on deeply nested duplicated tags', () => {
    let deep = 'core text'
    for (let i = 0; i < 300; i++) {
      deep = `<div><span>${deep}</span></div>`
    }
    expect(sanitizeEmailHtml(deep)).toBe('core text')

    let deepFormatting = 'x'
    for (let i = 0; i < 200; i++) {
      deepFormatting = `<b><i>${deepFormatting}</i></b>`
    }
    const out = sanitizeEmailHtml(deepFormatting)
    expect(out.startsWith('<b><i><b><i>')).toBe(true)
    expect(out.endsWith('</i></b></i></b>')).toBe(true)
    expect(out).toContain('x')
  })
})
