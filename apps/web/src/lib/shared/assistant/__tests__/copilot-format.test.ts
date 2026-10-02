import { describe, expect, it } from 'vitest'
import { prepareAnswerMarkdown } from '../copilot-format'

describe('prepareAnswerMarkdown', () => {
  it('removes adjacent source markers in prose without altering code or array indices', () => {
    expect(prepareAnswerMarkdown('Sources [1] [2]. Use `array[1]` and array[1].').markdown).toBe(
      'Sources. Use `array[1]` and array\\[1].'
    )
  })

  it('preserves literal markers for draft transformations', () => {
    const { tree } = prepareAnswerMarkdown('Keep [2].', { stripCitations: false })
    expect(tree.children[0]).toMatchObject({
      type: 'paragraph',
      children: [{ type: 'text', value: 'Keep [2].' }],
    })
  })

  it('resolves reference links and protects numeric link labels', () => {
    expect(prepareAnswerMarkdown('[guide [2]][docs] [1].\n\n[docs]: /hc/guide').markdown).toBe(
      '[guide \\[2\\]](/hc/guide).'
    )
  })

  it('normalizes headings, task lists, tables and images to supported chat structures', () => {
    const { tree, markdown } = prepareAnswerMarkdown(
      '# Next steps\n\n- [x] Complete\n- [ ] Follow up\n\n| Plan | Cost |\n| --- | --- |\n| Cloud | Paid |\n\n![Screenshot](/uploads/shot.png)'
    )
    expect(tree.children.map((node) => node.type)).toEqual([
      'paragraph',
      'list',
      'paragraph',
      'paragraph',
      'paragraph',
    ])
    expect(markdown).toContain('- ☑ Complete\n- ☐ Follow up')
    expect(markdown).toContain('Cloud | Paid')
    expect(markdown).toContain('[Screenshot](/uploads/shot.png)')
  })

  it('escapes raw HTML in the Markdown mirror and retains it as literal editor text', () => {
    const { tree, markdown } = prepareAnswerMarkdown('<script>alert(1)</script>')
    expect(tree.children[0]).toMatchObject({
      type: 'paragraph',
      children: [{ type: 'text', value: '<script>alert(1)</script>' }],
    })
    expect(markdown).toBe('\\<script>alert(1)\\</script>')
  })

  it('keeps code fences verbatim, including headings and source-looking markers', () => {
    expect(prepareAnswerMarkdown('~~~sh\n# heading [1]\n* not  a bullet\n~~~').markdown).toBe(
      '```sh\n# heading [1]\n* not  a bullet\n```'
    )
  })

  it('retains raw HTML as literal text inside nested blocks', () => {
    const { tree } = prepareAnswerMarkdown('> <script>quoted</script>\n\n- <div>listed</div>')
    expect(tree.children[0]).toMatchObject({
      type: 'blockquote',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: '<script>quoted</script>' }],
        },
      ],
    })
    expect(tree.children[1]).toMatchObject({
      type: 'list',
      children: [
        {
          type: 'listItem',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: '<div>listed</div>' }],
            },
          ],
        },
      ],
    })
  })
})
