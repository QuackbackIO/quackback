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
          <path d="M0 0h10v10z" fill="#fe5e86" stroke-width="2"/>
          <circle cx="5" cy="5" r="4" opacity="0.5"></circle>
        </g>`)
    )
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><g transform="translate(1 2)" fill-rule="evenodd"><path d="M0 0h10v10z" fill="#fe5e86" stroke-width="2"/><circle cx="5" cy="5" r="4" opacity="0.5"/></g></svg>'
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

describe('sanitizeSvg: an internal stylesheet', () => {
  // Design tools (Illustrator by default) colour paths through a <style>
  // element and classes. Simple rules are copied onto the elements as
  // attributes, so the logo keeps its colours; the stylesheet itself never
  // survives.
  const styled = (css: string, inner: string) => wrap(`<defs><style>${css}</style></defs>${inner}`)

  it('keeps the colour a class rule gives', () => {
    const out = sanitizeSvg(
      styled('.cls-1{fill:#635bff;}', '<path class="cls-1" d="M0 0h10v10z"/>')
    )
    expect(out).toContain('<path d="M0 0h10v10z" fill="#635bff"/>')
    expect(out).not.toMatch(/style|class/)
  })

  it('reads a stylesheet wrapped in CDATA instead of refusing the file', () => {
    const out = sanitizeSvg(
      wrap(
        '<style><![CDATA[ .a { fill: #ff0000 } /* note */ ]]></style><path class="a" d="M0 0h1"/>'
      )
    )
    expect(out).toContain('<path d="M0 0h1" fill="#ff0000"/>')
  })

  it('matches element, id and class selectors, and comma lists', () => {
    const out = sanitizeSvg(
      styled(
        'rect, #ring { stroke: #00ff00; stroke-width: 2 } .x,.y{fill-opacity:.5}',
        '<rect width="1" height="1"/><circle id="ring" r="1" class="y"/><path class="z x" d="M0 0h1"/>'
      )
    )
    expect(out).toContain('<rect width="1" height="1" stroke="#00ff00" stroke-width="2"/>')
    expect(out).toContain(
      '<circle id="ring" r="1" stroke="#00ff00" stroke-width="2" fill-opacity=".5"/>'
    )
    expect(out).toContain('<path d="M0 0h1" fill-opacity=".5"/>')
  })

  it('applies rules last wins per element, under the inline style and over attributes', () => {
    // Deliberately simpler than CSS specificity: rules apply in document
    // order, whatever their selector, then the element's own style attribute.
    const out = sanitizeSvg(
      styled(
        '.a{fill:#ff0000;stroke:#111111} path{fill:#0000ff}',
        '<path class="a" fill="#000000" stroke="#222222" style="stroke:#333333" d="M0 0h1"/>'
      )
    )
    expect(out).toContain('<path fill="#0000ff" stroke="#333333" d="M0 0h1"/>')
  })

  it('drops hostile rules, keeping the file and its safe rules', () => {
    const out = sanitizeSvg(
      styled(
        '@import url(https://evil.test/x.css); @media screen { .a { fill: #000 } }' +
          '.a{fill:url(https://evil.test/#g);behavior:url(x.htc);stroke:expression(alert(1))}' +
          '.b{fill:#123456;-moz-binding:url(x)} .c{fill:url(#grad)}',
        '<linearGradient id="grad"><stop offset="0" stop-color="#fff"/></linearGradient>' +
          '<path class="a" d="M0 0h1"/><path class="b" d="M0 0h2"/><path class="c" d="M0 0h3"/>'
      )
    )
    expect(out).not.toBeNull()
    expect(out).not.toMatch(/evil|import|expression|behavior|binding|htc|@media/)
    expect(out).toContain('<path d="M0 0h1"/>')
    expect(out).toContain('<path d="M0 0h2" fill="#123456"/>')
    expect(out).toContain('<path d="M0 0h3" fill="url(#grad)"/>')
  })

  it('copies only presentation properties, and display only as none', () => {
    const out = sanitizeSvg(
      styled(
        '.a{display:none} .b{display:block;font-size:40px;transform:scale(9);stop-color:#abc}',
        '<path class="a" d="M0 0h1"/><path class="b" d="M0 0h2"/>'
      )
    )
    expect(out).toContain('<path d="M0 0h1" display="none"/>')
    expect(out).toContain('<path d="M0 0h2" stop-color="#abc"/>')
  })

  it('ignores selectors it does not read, such as descendants and attributes', () => {
    const out = sanitizeSvg(
      styled(
        'g .a{fill:#f00} [class=a]{fill:#0f0} .a:hover{fill:#00f}',
        '<g><path class="a" d="M0 0h1"/></g>'
      )
    )
    expect(out).toContain('<g><path d="M0 0h1"/></g>')
  })

  it('still refuses CDATA outside a stylesheet', () => {
    expect(sanitizeSvg(wrap(`<text><![CDATA[hi]]></text>${box}`))).toBeNull()
  })

  it('refuses a stylesheet that is never closed', () => {
    expect(
      sanitizeSvg('<svg viewBox="0 0 1 1"><style>.a{fill:red}<path d="M0 0h1"/></svg>')
    ).toBeNull()
  })
})
