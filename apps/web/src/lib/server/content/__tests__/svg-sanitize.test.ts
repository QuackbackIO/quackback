import { describe, expect, it } from 'vitest'
import { sanitizeSvg, svgViewBoxSize } from '../svg-sanitize'

const wrap = (inner: string, attrs = 'viewBox="0 0 100 40"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`
const box = '<rect width="10" height="10" fill="#123456"/>'

describe('sanitizeSvg', () => {
  it('keeps drawing elements and presentation attributes, compactly', () => {
    const out = sanitizeSvg(
      wrap(`
        <g transform="translate(1 2)" fill-rule="evenodd">
          <path d="M0 0h10v10z" fill="#ff6600" stroke-width="2"/>
          <circle cx="5" cy="5" r="4" opacity="0.5"></circle>
        </g>`)
    )
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><g transform="translate(1 2)" fill-rule="evenodd"><path d="M0 0h10v10z" fill="#ff6600" stroke-width="2"/><circle cx="5" cy="5" r="4" opacity="0.5"/></g></svg>'
    )
  })

  it('is deterministic', () => {
    const input = wrap(`<g>${box}</g>`)
    expect(sanitizeSvg(input)).toBe(sanitizeSvg(input))
  })

  it('drops script elements and their content', () => {
    const out = sanitizeSvg(wrap(`<script>alert(1)</script>${box}`))
    expect(out).not.toMatch(/script|alert/)
    expect(out).toContain('<rect')
  })

  it('drops foreignObject with its subtree', () => {
    const out = sanitizeSvg(wrap(`<foreignObject><div>hi</div></foreignObject>${box}`))
    expect(out).not.toMatch(/foreignObject|div|hi/)
  })

  it('drops every on* attribute', () => {
    const out = sanitizeSvg(
      wrap(
        '<rect width="1" height="1" onclick="x()" onload="y()"/>',
        'viewBox="0 0 1 1" onload="z()"'
      )
    )
    expect(out).not.toMatch(/on\w+=/)
  })

  it('keeps only same-document hrefs on use', () => {
    const out = sanitizeSvg(
      wrap(
        `<defs><path id="p" d="M0 0h1"/></defs><use href="#p"/><use xlink:href="#p"/>` +
          `<use href="https://evil.test/a.svg#p"/><use href="data:image/svg+xml,xx"/><use href="javascript:alert(1)"/>`
      )
    )
    expect(out).toContain('<use href="#p"/><use href="#p"/><use/><use/><use/>')
    expect(out).not.toMatch(/evil|data:|javascript/)
  })

  it('drops image elements entirely, remote or embedded', () => {
    const out = sanitizeSvg(
      wrap(`<image href="https://cdn.test/x.png"/><image href="data:image/png;base64,AAAA"/>${box}`)
    )
    expect(out).not.toMatch(/image|cdn|base64/)
  })

  it('unwraps links, keeping what they draw', () => {
    const out = sanitizeSvg(wrap(`<a href="https://evil.test">${box}</a>`))
    expect(out).toBe(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">${box}</svg>`)
  })

  it('drops animate and set elements', () => {
    const out = sanitizeSvg(
      wrap(
        `<rect width="1" height="1"><animate attributeName="x" to="5"/><set attributeName="fill" to="red"/></rect>`
      )
    )
    expect(out).not.toMatch(/animate|set|attributeName/)
  })

  it('drops style elements', () => {
    const out = sanitizeSvg(wrap(`<style>rect{fill:url(https://evil.test)}</style>${box}`))
    expect(out).not.toMatch(/style|evil/)
  })

  it('turns simple style declarations into attributes and drops unsafe ones', () => {
    const simple = sanitizeSvg(
      wrap(
        '<rect width="1" height="1" fill="#000" style="fill:#ff0000; stroke: #00ff00; position: absolute"/>'
      )
    )
    expect(simple).toContain('<rect width="1" height="1" fill="#ff0000" stroke="#00ff00"/>')
    for (const style of [
      'fill:url(https://evil.test/x)',
      'fill:expression(alert(1))',
      '@import "x.css"; fill:#fff',
    ]) {
      const out = sanitizeSvg(wrap(`<rect width="1" height="1" style='${style}'/>`))
      expect(out).toContain('<rect width="1" height="1"/>')
    }
  })

  it('drops class attributes and unknown attributes', () => {
    const out = sanitizeSvg(wrap('<rect class="logo" data-x="1" width="1" height="1"/>'))
    expect(out).toContain('<rect width="1" height="1"/>')
  })

  it('keeps url(#id) references and drops any other url()', () => {
    const out = sanitizeSvg(
      wrap(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>' +
          '<rect width="1" height="1" fill="url(#g)" clip-path="url(https://evil.test/#c)" mask="url(data:x)"/>'
      )
    )
    expect(out).toContain('<rect width="1" height="1" fill="url(#g)"/>')
    expect(out).toContain(
      '<linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient>'
    )
  })

  it('refuses entity declarations and internal DOCTYPE subsets', () => {
    expect(
      sanitizeSvg(`<!DOCTYPE svg [<!ENTITY x "boom">]>${wrap(`<text>&x;</text>${box}`)}`)
    ).toBeNull()
  })

  it('accepts a plain XML declaration and an external DOCTYPE, dropping both', () => {
    const out = sanitizeSvg(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<!-- made by hand -->\n${wrap(box)}`
    )
    expect(out).toBe(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">${box}</svg>`)
  })

  it('refuses processing instructions and CDATA inside the document', () => {
    expect(sanitizeSvg(wrap(`<?xml-stylesheet href="x.css"?>${box}`))).toBeNull()
    expect(sanitizeSvg(wrap(`<text><![CDATA[hi]]></text>${box}`))).toBeNull()
  })

  it('refuses unknown entities and unbalanced markup', () => {
    expect(sanitizeSvg(wrap(`<text>&nbsp;</text>${box}`))).toBeNull()
    expect(sanitizeSvg(`<svg viewBox="0 0 1 1"><g>${box}`)).toBeNull()
    expect(sanitizeSvg(`<svg viewBox="0 0 1 1">${box}</g></svg>`)).toBeNull()
    expect(sanitizeSvg(`<div>${box}</div>`)).toBeNull()
    expect(sanitizeSvg(`${wrap(box)}${wrap(box)}`)).toBeNull()
  })

  it('closes elements an HTML page left open inside their parent', () => {
    const out = sanitizeSvg('<svg viewBox="0 0 10 10"><path d="M0 0h1"></svg>')
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h1"/></svg>'
    )
  })

  it('decodes and re-escapes text and attributes', () => {
    const out = sanitizeSvg(wrap(`<title>Acme &amp; Co &#169;</title>${box}`))
    expect(out).toContain('<title>Acme &amp; Co ©</title>')
  })

  it('replaces currentColor when asked', () => {
    const input = wrap('<path d="M0 0h1" fill="currentColor" style="stroke:currentcolor"/>')
    expect(sanitizeSvg(input, { currentColor: '#1a2b3c' })).toContain(
      '<path d="M0 0h1" fill="#1a2b3c" stroke="#1a2b3c"/>'
    )
    expect(sanitizeSvg(input)).toContain('fill="currentColor"')
    expect(sanitizeSvg(input, { currentColor: 'red;x' })).toContain('fill="currentColor"')
  })

  it('adds a viewBox from width and height, and an xmlns', () => {
    expect(sanitizeSvg(`<svg width="120px" height="30">${box}</svg>`)).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 30" width="120px" height="30">${box}</svg>`
    )
    expect(sanitizeSvg(`<svg>${box}</svg>`)).toBeNull()
  })

  it('caps the size in and out', () => {
    const big = wrap(box.repeat(5_000))
    expect(sanitizeSvg(big)).toBeNull()
    expect(sanitizeSvg(big, { maxBytes: 1_000_000 })).not.toBeNull()
  })

  it('refuses markup that draws nothing', () => {
    expect(sanitizeSvg(wrap('<script>x</script>'))).toBeNull()
  })

  it('accepts unquoted attributes from minified HTML', () => {
    expect(sanitizeSvg('<svg viewBox="0 0 4 4" fill=none><path d=M0 /></svg>')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4" fill="none"><path d="M0"/></svg>'
    )
  })
})

describe('svgViewBoxSize', () => {
  it('reads the viewBox width and height', () => {
    expect(svgViewBoxSize('<svg xmlns="x" viewBox="0 0 120 30"/>')).toEqual({
      width: 120,
      height: 30,
    })
    expect(svgViewBoxSize('<svg/>')).toBeNull()
  })
})
