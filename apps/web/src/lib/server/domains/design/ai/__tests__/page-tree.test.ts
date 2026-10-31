import { describe, expect, it } from 'vitest'
import { pageTree } from '../page-tree'

describe('pageTree', () => {
  it('gives each element its parent and each link its words', () => {
    const nodes = pageTree(
      `<body class="x"><div><img src="a.png"><a href="/" class="cta"><span>Get</span> started</a></div><p>After</p></body>`
    )
    const [body, div, img, link, span, p] = nodes
    expect(body!.parent).toBe(-1)
    expect(div!.parent).toBe(0)
    expect(img!.parent).toBe(1)
    expect(link!.parent).toBe(1)
    expect(span!.parent).toBe(3)
    expect(link!.text).toBe('Get started')
    // A void element and a closed element leave the next one at the right depth.
    expect(p!.parent).toBe(0)
  })

  it('closes elements a page leaves open when their parent closes', () => {
    const nodes = pageTree(`<ul><li>One<li>Two</ul><footer></footer>`)
    expect(nodes.find((n) => n.tag === 'footer')!.parent).toBe(-1)
  })

  it('leaves scripts out', () => {
    const nodes = pageTree(`<div><script>document.write('<a>Get started</a>')</script></div>`)
    expect(nodes.map((n) => n.tag)).toEqual(['div'])
  })

  it('marks the elements that hold words of their own', () => {
    const nodes = pageTree(`<section><div><span>Hello</span></div><p> 
      Text</p></section>`)
    expect(nodes.map((n) => [n.tag, !!n.worded])).toEqual([
      ['section', false],
      ['div', false],
      ['span', true],
      ['p', true],
    ])
  })
})
