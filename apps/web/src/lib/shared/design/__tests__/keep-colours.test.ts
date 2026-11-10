/**
 * Quackback AI's rewrite of rich words keeps the colours on words it did not
 * touch: where it colours some words, or changes some, and leaves out the
 * colour other words had, those words keep theirs. A request to take colours
 * away is followed as written.
 */
import { describe, expect, it } from 'vitest'
import { applyOps, type OpWorld } from '../design-ops'
import { keepColours, readRichMarkdown, type WordsDoc, type WordsNode } from '../rich-words'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'

const read = (markup: string): WordsDoc => {
  const out = readRichMarkdown(markup)
  if (!out.ok) throw new Error(out.refusal)
  return out.doc
}
const BEFORE = read('## Welcome {center}\n\nTell us [what to build]{support} next.')

/** The words coloured in each role, in order. */
function coloured(doc: WordsDoc): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (node: WordsNode) => {
    const role = node.marks?.find((m) => m.type === 'colour')?.attrs?.role
    if (node.type === 'text' && typeof role === 'string') {
      const last = out[out.length - 1]
      if (last && last[1] === role) last[0] += node.text ?? ''
      else out.push([node.text ?? '', role])
    }
    node.content?.forEach(walk)
  }
  doc.content?.forEach(walk)
  return out
}

describe('keeping colours a rewrite dropped', () => {
  it('keeps the colour on words the model did not touch when it colours others', () => {
    const after = read('## Welcome {center}\n\nTell us what to build [next]{accent}.')
    expect(coloured(keepColours(BEFORE, after))).toEqual([
      ['what to build', 'support'],
      ['next', 'accent'],
    ])
  })

  it('keeps it when the words around it change', () => {
    const after = read('## Welcome {center}\n\nTell us what to build this year.')
    const kept = keepColours(BEFORE, after)
    expect(coloured(kept)).toEqual([['what to build', 'support']])
    expect(kept.content?.[0]?.attrs?.textAlign).toBe('center')
  })

  it('follows a rewrite that only takes colours away', () => {
    const after = read('## Welcome {center}\n\nTell us what to build next.')
    expect(coloured(keepColours(BEFORE, after))).toEqual([])
  })

  it('leaves a colour the model changed as it wrote it, and bold and links alone', () => {
    const after = read('## Welcome {center}\n\nTell us **[what to build]{accent}** next.')
    const kept = keepColours(BEFORE, after)
    expect(coloured(kept)).toEqual([['what to build', 'accent']])
    expect(JSON.stringify(kept)).toContain('"bold"')
  })
})

describe('through the operations', () => {
  const world = (request: string): OpWorld => ({
    gates: {
      feedback: true,
      roadmap: true,
      changelog: true,
      help: true,
      support: true,
      status: true,
    },
    places: { boards: [], roadmaps: [], categories: [] },
    request,
    untrusted: { blockTypes: ['welcome'], links: new Set(), checkCss: () => null },
  })
  const design = (): PortalDesign => {
    const d = defaultDesign()
    d.pages.home.blocks = [
      { id: 'welcome001', type: 'welcome', body: BEFORE, grid: { x: 0, y: 0, w: 12, h: 1 } },
    ] as PortalDesign['pages']['home']['blocks']
    return portalDesign.parse(d)
  }
  const body = (d: PortalDesign) => (d.pages.home.blocks[0] as unknown as { body: WordsDoc }).body
  const set = (request: string, value: string) =>
    applyOps(design(), world(request), [{ op: 'set', target: 'welcome001', key: 'body', value }])

  it('keeps the second colour when "next" is put in the brand colour', () => {
    const out = set(
      'Put "next" in the brand colour in the welcome text',
      '## Welcome {center}\n\nTell us what to build [next]{accent}.'
    )
    expect(coloured(body(out.design))).toEqual([
      ['what to build', 'support'],
      ['next', 'accent'],
    ])
  })

  it('takes a colour away when the request asks', () => {
    const out = set(
      'Remove the colour from "what to build" and put "next" in the brand colour',
      '## Welcome {center}\n\nTell us what to build [next]{accent}.'
    )
    expect(coloured(body(out.design))).toEqual([['next', 'accent']])
  })
})
