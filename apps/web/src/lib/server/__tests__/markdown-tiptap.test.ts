import { describe, test, expect } from 'vitest'
import { markdownToTiptapJson, tiptapJsonToMarkdown } from '../markdown-tiptap'

describe('markdownToTiptapJson', () => {
  test('converts a simple paragraph', () => {
    const result = markdownToTiptapJson('Hello world')
    expect(result.type).toBe('doc')
    expect(result.content).toBeDefined()
    expect(result.content!.length).toBeGreaterThan(0)
    expect(result.content![0].type).toBe('paragraph')
  })

  test('converts headings', () => {
    const result = markdownToTiptapJson('# Heading 1\n\n## Heading 2\n\n### Heading 3')
    const headings = result.content!.filter((n) => n.type === 'heading')
    expect(headings).toHaveLength(3)
    expect(headings[0].attrs?.level).toBe(1)
    expect(headings[1].attrs?.level).toBe(2)
    expect(headings[2].attrs?.level).toBe(3)
  })

  test('converts bold and italic marks', () => {
    const result = markdownToTiptapJson('This is **bold** and *italic* text')
    const paragraph = result.content![0]
    expect(paragraph.type).toBe('paragraph')
    const textNodes = paragraph.content!
    const boldNode = textNodes.find((n) => n.marks?.some((m) => m.type === 'bold'))
    const italicNode = textNodes.find((n) => n.marks?.some((m) => m.type === 'italic'))
    expect(boldNode).toBeDefined()
    expect(italicNode).toBeDefined()
  })

  test('converts bullet lists', () => {
    const result = markdownToTiptapJson('- Item 1\n- Item 2\n- Item 3')
    const bulletList = result.content!.find((n) => n.type === 'bulletList')
    expect(bulletList).toBeDefined()
    expect(bulletList!.content).toHaveLength(3)
  })

  test('converts ordered lists', () => {
    const result = markdownToTiptapJson('1. First\n2. Second\n3. Third')
    const orderedList = result.content!.find((n) => n.type === 'orderedList')
    expect(orderedList).toBeDefined()
    expect(orderedList!.content).toHaveLength(3)
  })

  test('converts code blocks with language', () => {
    const result = markdownToTiptapJson('```javascript\nconst x = 1\n```')
    const codeBlock = result.content!.find((n) => n.type === 'codeBlock')
    expect(codeBlock).toBeDefined()
    expect(codeBlock!.attrs?.language).toBe('javascript')
  })

  test('converts links', () => {
    const result = markdownToTiptapJson('[Click here](https://example.com)')
    const paragraph = result.content![0]
    const linkNode = paragraph.content!.find((n) => n.marks?.some((m) => m.type === 'link'))
    expect(linkNode).toBeDefined()
    const linkMark = linkNode!.marks!.find((m) => m.type === 'link')
    expect(linkMark!.attrs?.href).toBe('https://example.com')
  })

  test('converts images', () => {
    const result = markdownToTiptapJson('![Alt text](https://example.com/image.png)')
    const image = result.content!.find((n) => n.type === 'image')
    expect(image).toBeDefined()
    expect(image!.attrs?.src).toBe('https://example.com/image.png')
    expect(image!.attrs?.alt).toBe('Alt text')
  })

  test('converts blockquotes', () => {
    const result = markdownToTiptapJson('> This is a quote')
    const blockquote = result.content!.find((n) => n.type === 'blockquote')
    expect(blockquote).toBeDefined()
  })

  test('converts horizontal rules', () => {
    const result = markdownToTiptapJson('Above\n\n---\n\nBelow')
    const hr = result.content!.find((n) => n.type === 'horizontalRule')
    expect(hr).toBeDefined()
  })

  test('converts task lists', () => {
    const result = markdownToTiptapJson('- [x] Done\n- [ ] Not done')
    const taskList = result.content!.find((n) => n.type === 'taskList')
    expect(taskList).toBeDefined()
    expect(taskList!.content).toHaveLength(2)
  })

  test('handles empty string', () => {
    const result = markdownToTiptapJson('')
    expect(result.type).toBe('doc')
  })

  test('handles complex changelog-like content', () => {
    const markdown = `## New Features

- **Slack integration** - Two new ways to send feedback from Slack
- **AI signals** - AI-generated insights surfaced in the post modal

## Bug Fixes

- Fixed OAuth token exchange error
- Fixed widget vote highlights after SSO identify`

    const result = markdownToTiptapJson(markdown)
    expect(result.type).toBe('doc')
    const headings = result.content!.filter((n) => n.type === 'heading')
    expect(headings.length).toBeGreaterThanOrEqual(2)
    const lists = result.content!.filter((n) => n.type === 'bulletList')
    expect(lists.length).toBeGreaterThanOrEqual(2)
  })
})

describe('tiptapJsonToMarkdown', () => {
  test('serializes a simple paragraph', () => {
    const json = {
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    }
    const result = tiptapJsonToMarkdown(json)
    expect(result).toContain('Hello world')
  })

  test('serializes headings with # syntax', () => {
    const json = {
      type: 'doc' as const,
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'My Heading' }],
        },
      ],
    }
    const result = tiptapJsonToMarkdown(json)
    expect(result).toContain('## My Heading')
  })

  test('serializes bold marks', () => {
    const json = {
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'This is ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' text' },
          ],
        },
      ],
    }
    const result = tiptapJsonToMarkdown(json)
    expect(result).toContain('**bold**')
  })

  test('round-trips markdown through JSON and back', () => {
    const original = '## Heading\n\nA paragraph with **bold** text.\n\n- Item 1\n- Item 2'
    const json = markdownToTiptapJson(original)
    const roundTripped = tiptapJsonToMarkdown(json)

    // Round-tripped should contain the same semantic content
    expect(roundTripped).toContain('## Heading')
    expect(roundTripped).toContain('**bold**')
    expect(roundTripped).toContain('Item 1')
    expect(roundTripped).toContain('Item 2')
  })
})
