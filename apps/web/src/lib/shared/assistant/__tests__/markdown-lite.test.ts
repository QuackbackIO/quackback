/**
 * The one place the markdown-lite grammar is pinned: block structure
 * (paragraphs / bullet / ordered lists) plus each inline construct and its
 * grammar switch. Surface bindings are pinned thinly next to their consumers
 * (ask-ai-text.test.ts, copilot-format.test.ts).
 */
import { describe, it, expect } from 'vitest'
import { parseMarkdownLite } from '../markdown-lite'

describe('parseMarkdownLite blocks', () => {
  it('splits paragraphs on blank lines', () => {
    expect(parseMarkdownLite('First.\n\nSecond.')).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'First.' }]] },
      { kind: 'paragraph', lines: [[{ text: 'Second.' }]] },
    ])
  })

  it('keeps single newlines as separate lines within a paragraph', () => {
    expect(parseMarkdownLite('line one\nline two')).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'line one' }], [{ text: 'line two' }]] },
    ])
  })

  it('parses bullet lists', () => {
    expect(parseMarkdownLite('- one\n- two')).toEqual([
      { kind: 'list', ordered: false, items: [[{ text: 'one' }], [{ text: 'two' }]] },
    ])
  })

  it('treats asterisk bullets like dashes', () => {
    const blocks = parseMarkdownLite('* alpha\n* beta')
    expect(blocks[0].kind).toBe('list')
  })

  it('parses numbered lists as ordered (no start field when numbering begins at 1)', () => {
    expect(parseMarkdownLite('1. first\n2. second')).toEqual([
      { kind: 'list', ordered: true, items: [[{ text: 'first' }], [{ text: 'second' }]] },
    ])
  })

  it('carries the first item number as start when the list does not begin at 1', () => {
    expect(parseMarkdownLite('2. second\n3. third')).toEqual([
      { kind: 'list', ordered: true, start: 2, items: [[{ text: 'second' }], [{ text: 'third' }]] },
    ])
  })

  it('a numbered list split by a paragraph resumes with its own start', () => {
    expect(parseMarkdownLite('1. one\n2. two\n\nAn aside.\n\n3. three\n4. four')).toEqual([
      { kind: 'list', ordered: true, items: [[{ text: 'one' }], [{ text: 'two' }]] },
      { kind: 'paragraph', lines: [[{ text: 'An aside.' }]] },
      { kind: 'list', ordered: true, start: 3, items: [[{ text: 'three' }], [{ text: 'four' }]] },
    ])
  })

  it('keeps a mixed block (not every line a list marker) as a paragraph', () => {
    expect(parseMarkdownLite('Summary\n- one\n- two')).toEqual([
      {
        kind: 'paragraph',
        lines: [[{ text: 'Summary' }], [{ text: '- one' }], [{ text: '- two' }]],
      },
    ])
  })

  it('combines paragraphs and lists in one answer', () => {
    expect(parseMarkdownLite('Here is what to do:\n\n1. **Open** settings\n2. Click save')).toEqual(
      [
        { kind: 'paragraph', lines: [[{ text: 'Here is what to do:' }]] },
        {
          kind: 'list',
          ordered: true,
          items: [[{ text: 'Open', bold: true }, { text: ' settings' }], [{ text: 'Click save' }]],
        },
      ]
    )
  })

  it('returns no blocks for whitespace-only text', () => {
    expect(parseMarkdownLite('  \n\n  ')).toEqual([])
  })
})

describe('parseMarkdownLite inline grammar', () => {
  it('parses bold spans inside text', () => {
    expect(parseMarkdownLite('Use the **Invite member** button.')).toEqual([
      {
        kind: 'paragraph',
        lines: [
          [{ text: 'Use the ' }, { text: 'Invite member', bold: true }, { text: ' button.' }],
        ],
      },
    ])
  })

  it('parses [n] citation markers into cite spans when citations are on', () => {
    expect(parseMarkdownLite('Open Settings [1] then Team [2].', { citations: true })).toEqual([
      {
        kind: 'paragraph',
        lines: [
          [
            { text: 'Open Settings ' },
            { text: '1', cite: 1 },
            { text: ' then Team ' },
            { text: '2', cite: 2 },
            { text: '.' },
          ],
        ],
      },
    ])
  })

  it('handles a bold label and a citation in the same line', () => {
    expect(parseMarkdownLite('Click **Invite** [3].', { citations: true })).toEqual([
      {
        kind: 'paragraph',
        lines: [
          [
            { text: 'Click ' },
            { text: 'Invite', bold: true },
            { text: ' ' },
            { text: '3', cite: 3 },
            { text: '.' },
          ],
        ],
      },
    ])
  })

  it('leaves [n] markers literal when citations are off', () => {
    expect(parseMarkdownLite('See the guide [1].')).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'See the guide [1].' }]] },
    ])
  })

  it('parses *italic* and _italic_ runs into italic spans when italic is on', () => {
    expect(parseMarkdownLite('A *subtle* hint and an _aside_ too.', { italic: true })).toEqual([
      {
        kind: 'paragraph',
        lines: [
          [
            { text: 'A ' },
            { text: 'subtle', italic: true },
            { text: ' hint and an ' },
            { text: 'aside', italic: true },
            { text: ' too.' },
          ],
        ],
      },
    ])
  })

  it('leaves italic markers literal when italic is off', () => {
    expect(parseMarkdownLite('A *subtle* hint.')).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'A *subtle* hint.' }]] },
    ])
  })

  it('leaves snake_case identifiers and stray asterisk math literal with italic on', () => {
    expect(parseMarkdownLite('Set user_id_field to 2 * 3 * 4.', { italic: true })).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'Set user_id_field to 2 * 3 * 4.' }]] },
    ])
  })

  it('parses single-backtick runs into code spans when code is on', () => {
    expect(parseMarkdownLite('Run `bun install` first.', { code: true })).toEqual([
      {
        kind: 'paragraph',
        lines: [[{ text: 'Run ' }, { text: 'bun install', code: true }, { text: ' first.' }]],
      },
    ])
  })

  it('leaves backticks literal when code is off', () => {
    expect(parseMarkdownLite('Run `bun install` first.')).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'Run `bun install` first.' }]] },
    ])
  })

  it('keeps inner markers literal inside a code span, and an unpaired backtick literal', () => {
    expect(parseMarkdownLite('Set `**not bold**` or ` nothing', { code: true })).toEqual([
      {
        kind: 'paragraph',
        lines: [
          [{ text: 'Set ' }, { text: '**not bold**', code: true }, { text: ' or ` nothing' }],
        ],
      },
    ])
  })

  it('prefers **bold** over *italic* on the same markers', () => {
    expect(parseMarkdownLite('So **very** sure.', { italic: true })).toEqual([
      {
        kind: 'paragraph',
        lines: [[{ text: 'So ' }, { text: 'very', bold: true }, { text: ' sure.' }]],
      },
    ])
  })
})
