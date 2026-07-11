import { describe, it, expect } from 'vitest'
import {
  stripCitationMarkers,
  formatConversationSummaryNote,
  parseAnswerMarkdown,
  answerMarkdownForInsert,
} from '../copilot-format'

describe('stripCitationMarkers', () => {
  it('removes a single inline marker without leaving a double space', () => {
    expect(stripCitationMarkers('The refund window is 30 days [1].')).toBe(
      'The refund window is 30 days.'
    )
  })

  it('removes multiple markers anywhere in the text', () => {
    expect(stripCitationMarkers('First point [1]. Second point [2].')).toBe(
      'First point. Second point.'
    )
  })

  it('removes adjacent markers with no leftover spacing', () => {
    expect(stripCitationMarkers('Confirmed by two sources [1] [2].')).toBe(
      'Confirmed by two sources.'
    )
  })

  it('removes a marker glued to the preceding word with no space', () => {
    expect(stripCitationMarkers('See settings[1] for details.')).toBe('See settings for details.')
  })

  it('removes a marker at the very start of the text', () => {
    expect(stripCitationMarkers('[1] Refunds are processed within 30 days.')).toBe(
      'Refunds are processed within 30 days.'
    )
  })

  it('leaves text with no markers unchanged (aside from trimming)', () => {
    expect(stripCitationMarkers('No citations here.')).toBe('No citations here.')
  })

  it('preserves newlines and list structure', () => {
    const input = 'Steps to resolve [1]:\n- Reset the password [2]\n- Confirm the email [3]'
    expect(stripCitationMarkers(input)).toBe(
      'Steps to resolve:\n- Reset the password\n- Confirm the email'
    )
  })

  it('trims surrounding whitespace', () => {
    expect(stripCitationMarkers('  padded text [1]  ')).toBe('padded text')
  })
})

describe('formatConversationSummaryNote', () => {
  it('formats a Question line and a Summary bullet list', () => {
    const text = formatConversationSummaryNote('Duplicate March invoice charge', [
      'Customer was charged twice for their March invoice.',
      'Refunded the duplicate charge.',
    ])
    expect(text).toBe(
      'Question\nDuplicate March invoice charge\n\nSummary\n- Customer was charged twice for their March invoice.\n- Refunded the duplicate charge.'
    )
  })

  it('formats a single bullet with no trailing separator', () => {
    const text = formatConversationSummaryNote('Refund window', ['Explained the 30-day window.'])
    expect(text).toBe('Question\nRefund window\n\nSummary\n- Explained the 30-day window.')
  })

  it('renders an empty bullet list as a bare Summary heading', () => {
    const text = formatConversationSummaryNote('Unresolved billing question', [])
    expect(text).toBe('Question\nUnresolved billing question\n\nSummary\n')
  })
})

describe('answerMarkdownForInsert', () => {
  it('strips citation markers, including marker-adjacent punctuation cleanup', () => {
    expect(answerMarkdownForInsert('The refund window is 30 days [1].')).toBe(
      'The refund window is 30 days.'
    )
  })

  it('keeps mappable markdown (bold, italic, inline code, lists) intact', () => {
    const input = '**Bold**, *italic*, and `code`.\n\n- one\n- two'
    expect(answerMarkdownForInsert(input)).toBe(input)
  })

  it('strips heading markers but keeps the heading text', () => {
    expect(answerMarkdownForInsert('## Next steps\nDo the thing.')).toBe(
      'Next steps\nDo the thing.'
    )
  })

  it('keeps `[n]` markers when stripCitations is off (the draft-transform path)', () => {
    expect(
      answerMarkdownForInsert('See item [2] and run `bun install`.', { stripCitations: false })
    ).toBe('See item [2] and run `bun install`.')
  })

  it('keeps a code fence verbatim — no citation/heading stripping inside it', () => {
    const input = 'Fix it like this:\n\n```\n# not a heading [1]\n* not  a bullet\n```\n\nDone [1].'
    expect(answerMarkdownForInsert(input)).toBe(
      'Fix it like this:\n\n```\n# not a heading [1]\n* not  a bullet\n```\n\nDone.'
    )
  })
})

// The markdown-lite grammar itself (bold/lists/paragraph structure) is pinned
// once in markdown-lite.test.ts; these pin this surface's insert deltas on
// top of it — citation/heading stripping, fences, and the italic+code grammar
// — through the two real seams the composer conversion runs
// (answerMarkdownForInsert then parseAnswerMarkdown, exactly as
// copilot-insert-content.ts composes them).
describe('parseAnswerMarkdown (over answerMarkdownForInsert)', () => {
  const toBlocks = (text: string) => parseAnswerMarkdown(answerMarkdownForInsert(text))

  it('passes plain text through as a single unmarked paragraph span', () => {
    expect(toBlocks('Just a plain answer.')).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'Just a plain answer.' }]] },
    ])
  })

  it('strips citation markers without leaving stray spaces before punctuation', () => {
    expect(toBlocks('Refunds take 30 days [1], sometimes fewer [2].')).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'Refunds take 30 days, sometimes fewer.' }]] },
    ])
  })

  it('parses *italic* and _italic_ runs into italic spans (this surface enables italic)', () => {
    expect(toBlocks('A *subtle* hint and an _aside_ too.')).toEqual([
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

  it('parses single-backtick runs into code spans (this surface enables code)', () => {
    expect(toBlocks('Run `bun install` now.')).toEqual([
      {
        kind: 'paragraph',
        lines: [[{ text: 'Run ' }, { text: 'bun install', code: true }, { text: ' now.' }]],
      },
    ])
  })

  it('strips citation markers inside list items while keeping the list structure', () => {
    expect(toBlocks('- Reset the password [1]\n- **Confirm** the email')).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [
          [{ text: 'Reset the password' }],
          [{ text: 'Confirm', bold: true }, { text: ' the email' }],
        ],
      },
    ])
  })

  it('strips heading markers rather than passing them through', () => {
    expect(toBlocks('## Fix\nRun it now.')).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'Fix' }], [{ text: 'Run it now.' }]] },
    ])
  })

  it('emits a fence as a verbatim codeBlock between the surrounding blocks', () => {
    expect(toBlocks('Before.\n\n```sh\n* item-looking line\nbun install\n```\n\nAfter.')).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'Before.' }]] },
      { kind: 'codeBlock', text: '* item-looking line\nbun install' },
      { kind: 'paragraph', lines: [[{ text: 'After.' }]] },
    ])
  })

  it('keeps `[n]` markers as literal text on the stripCitations-off path', () => {
    expect(
      parseAnswerMarkdown(answerMarkdownForInsert('Keep [2] here.', { stripCitations: false }))
    ).toEqual([{ kind: 'paragraph', lines: [[{ text: 'Keep [2] here.' }]] }])
  })

  it('returns no blocks for an answer that is only citation markers', () => {
    expect(toBlocks(' [1] [2] ')).toEqual([])
  })
})
