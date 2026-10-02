/** Markdown insertion preserves the conversation editor node schema. */
import { describe, it, expect } from 'vitest'
import { answerToInsertContent } from '../copilot-insert-content'

const answerToTiptapContent = (text: string) => answerToInsertContent(text).nodes

describe('answerToInsertContent', () => {
  it('keeps Markdown links intact when their label contains a numeric citation', () => {
    const { nodes } = answerToInsertContent('Read [guide [1]](https://example.com/guide) [1].')
    expect(nodes[0].content).toEqual([
      { type: 'text', text: 'Read ' },
      {
        type: 'text',
        text: 'guide [1]',
        marks: [{ type: 'link', attrs: { href: 'https://example.com/guide' } }],
      },
      { type: 'text', text: '.' },
    ])
  })

  it('preserves inline code and array indices while removing actual source markers', () => {
    const { nodes } = answerToInsertContent('Use `array[1]` and array[1]. Read [1].')
    expect(nodes[0].content).toEqual([
      { type: 'text', text: 'Use ' },
      { type: 'text', text: 'array[1]', marks: [{ type: 'code' }] },
      { type: 'text', text: ' and array[1]. Read.' },
    ])
  })

  it('parses nested bold and italic into combined marks', () => {
    const { nodes } = answerToInsertContent('**Bold and *italic***')
    expect(nodes[0].content).toEqual([
      { type: 'text', text: 'Bold and ', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'italic', marks: [{ type: 'bold' }, { type: 'italic' }] },
    ])
  })

  it('keeps nested lists and blockquotes as editor blocks', () => {
    const { nodes } = answerToInsertContent('- Parent\n  - Child\n\n> Quoted advice')
    expect(nodes[0].content?.[0].content?.[1].type).toBe('bulletList')
    expect(nodes[1].type).toBe('blockquote')
  })

  it('keeps tildes and indented fences verbatim, including citation-looking code', () => {
    const { nodes } = answerToInsertContent('~~~js\narray[1]\n~~~\n\n  ```sh\n  echo [1]\n  ```')
    expect(nodes.map((node) => node.type)).toEqual(['codeBlock', 'codeBlock'])
    expect(nodes[0].content?.[0].text).toBe('array[1]')
    expect(nodes[1].content?.[0].text).toBe('echo [1]')
  })

  it('refuses executable link destinations when inserting an answer', () => {
    const { nodes } = answerToInsertContent('[unsafe](javascript:alert%281%29)')
    expect(nodes[0].content).toEqual([{ type: 'text', text: 'unsafe' }])
  })
  it('uses a hard break for consecutive lines in a chat paragraph', () => {
    expect(answerToTiptapContent('First line.\nSecond line.')).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'First line.' },
          { type: 'hardBreak' },
          { type: 'text', text: 'Second line.' },
        ],
      },
    ])
  })

  it('strips citation markers instead of inserting them as literal text', () => {
    expect(answerToTiptapContent('The refund window is 30 days [1].')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'The refund window is 30 days.' }] },
    ])
  })

  it('converts **bold** to a bold mark instead of literal asterisks', () => {
    expect(answerToTiptapContent('This is **important**.')).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'This is ' },
          { type: 'text', text: 'important', marks: [{ type: 'bold' }] },
          { type: 'text', text: '.' },
        ],
      },
    ])
  })

  it('converts *italic* to an italic mark', () => {
    expect(answerToTiptapContent('A *subtle* hint.')).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'A ' },
          { type: 'text', text: 'subtle', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' hint.' },
        ],
      },
    ])
  })

  it('converts a bullet block to a bulletList of listItem paragraphs', () => {
    expect(answerToTiptapContent('- Reset the password [1]\n- Confirm the email')).toEqual([
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Reset the password' }] },
            ],
          },
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Confirm the email' }] },
            ],
          },
        ],
      },
    ])
  })

  it('converts a numbered block to an orderedList (no start attrs at 1)', () => {
    const nodes = answerToTiptapContent('1. First\n2. Second')
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('orderedList')
    expect(nodes[0].attrs).toBeUndefined()
    expect(nodes[0].content).toHaveLength(2)
    expect(nodes[0].content?.[0]).toEqual({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }],
    })
  })

  it('emits attrs.start on an orderedList that does not begin at 1', () => {
    const nodes = answerToTiptapContent('2. Second\n3. Third')
    expect(nodes[0].type).toBe('orderedList')
    expect(nodes[0].attrs).toEqual({ start: 2 })
  })

  it('preserves a zero-based numbered list', () => {
    expect(answerToTiptapContent('0. Zero\n1. One')[0].attrs).toEqual({ start: 0 })
  })

  it('a numbered list split by a paragraph resumes at its own start', () => {
    const nodes = answerToTiptapContent('1. one\n2. two\n\nAn aside.\n\n3. three\n4. four')
    expect(nodes.map((n) => n.type)).toEqual(['orderedList', 'paragraph', 'orderedList'])
    expect(nodes[0].attrs).toBeUndefined()
    expect(nodes[2].attrs).toEqual({ start: 3 })
  })

  it('converts single-backtick runs to a code mark instead of stripping them', () => {
    expect(answerToTiptapContent('Run `bun install` first.')).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Run ' },
          { type: 'text', text: 'bun install', marks: [{ type: 'code' }] },
          { type: 'text', text: ' first.' },
        ],
      },
    ])
  })

  it('emits a fence as a verbatim codeBlock node, list-looking lines and all', () => {
    const { nodes, markdown } = answerToInsertContent(
      'Fix:\n\n```sh\n* keep this literal [1]\nbun install\n```\n\nDone [1].'
    )
    expect(nodes).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Fix:' }] },
      {
        type: 'codeBlock',
        attrs: { language: 'sh' },
        content: [{ type: 'text', text: '* keep this literal [1]\nbun install' }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Done.' }] },
    ])
    // The fence survives in the markdown mirror too.
    expect(markdown).toBe('Fix:\n\n```sh\n* keep this literal [1]\nbun install\n```\n\nDone.')
  })

  it('keeps [n] markers and inline code through the draft-transform path (stripCitations off)', () => {
    const { nodes, markdown } = answerToInsertContent('Keep [2] and `code` as-is.', {
      stripCitations: false,
    })
    expect(markdown).toBe('Keep \\[2] and `code` as-is.')
    expect(nodes).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Keep [2] and ' },
          { type: 'text', text: 'code', marks: [{ type: 'code' }] },
          { type: 'text', text: ' as-is.' },
        ],
      },
    ])
  })

  it('mixes paragraph and list blocks across a multi-paragraph answer', () => {
    const nodes = answerToTiptapContent('Do this:\n\n- one\n- two\n\nThen reply.')
    expect(nodes.map((n) => n.type)).toEqual(['paragraph', 'bulletList', 'paragraph'])
  })

  it('yields a single empty paragraph for an answer that parses to nothing', () => {
    expect(answerToTiptapContent(' [1] ')).toEqual([{ type: 'paragraph' }])
  })

  it('returns the marker-stripped markdown mirror alongside the nodes', () => {
    const { markdown } = answerToInsertContent('The refund window is 30 days [1], **really**.')
    expect(markdown).toBe('The refund window is 30 days, **really**.')
  })
})
