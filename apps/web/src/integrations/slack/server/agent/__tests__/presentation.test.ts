import { describe, it, expect } from 'vitest'
import { generateId } from '@quackback/ids'
import {
  mapSlackThread,
  toSlackMrkdwn,
  SlackMarkdownStream,
  buildProposalBlocks,
} from '../presentation'
describe('Slack presentation', () => {
  it('maps the bot and collapses adjacent human history, keeping the trigger last', () => {
    const result = mapSlackThread(
      [
        { user: 'U1', text: 'first', ts: '1' },
        { user: 'U2', text: 'second', ts: '2' },
        { user: 'B', text: 'answer', ts: '3' },
        { user: 'U1', text: '<@B> next', ts: '4' },
      ],
      { user: 'U1', text: '<@B> next', ts: '4' },
      'B'
    )
    expect(result.messages).toEqual([
      { sender: 'customer', content: 'U1: first\nU2: second' },
      { sender: 'assistant', content: 'answer' },
      { sender: 'customer', content: 'next' },
    ])
  })
  it('bounds both representations even when the trigger exhausts the budget', () => {
    for (const length of [3980, 3990, 4000, 5000]) {
      const result = mapSlackThread(
        Array.from({ length: 30 }, (_, i) => ({
          user: 'U'.repeat(40),
          text: 'y'.repeat(6000),
          ts: String(i),
        })),
        { text: 'x'.repeat(length), ts: '31' },
        'B'
      )
      expect(result.contextBlock.length).toBeLessThanOrEqual(4000)
      expect(result.messages.map((m) => m.content).join('\n').length).toBeLessThanOrEqual(4000)
      expect(result.messages.length).toBeLessThanOrEqual(12)
    }
  })
  it('converts headings, links, bold and tables without allowing mention injection', () => {
    const text = toSlackMrkdwn(
      '# Heading\n**bold** [link](https://example.com) <@U>\n| A | B |\n|---|---|'
    )
    expect(text).toContain('*Heading*\n*bold* <https://example.com|link> &lt;@U&gt;')
    expect(text).toContain('• A · B')
    expect(text).not.toContain('|---|')
  })
  it('streams ordinary words before a paragraph ends', () => {
    const stream = new SlackMarkdownStream()
    expect(stream.append('Here are the top ')).toBe('Here are the top ')
    expect(stream.append('requests')).toBe('')
    expect(stream.finish()).toBe('requests')
  })

  it('holds split markup until it can be converted correctly', () => {
    const stream = new SlackMarkdownStream()
    expect(stream.append('**bo')).toBe('')
    expect(stream.append('ld**\n')).toBe('*bold*\n')
    expect(stream.append('[label](https://example.com)')).toBe('')
    expect(stream.finish()).toBe('<https://example.com|label>')
  })
  it('buttons contain only the pending-action id', () => {
    const id = generateId('assistant_action')
    const blocks = buildProposalBlocks({ id, summary: 'Create feedback <@all>' }) as any[]
    expect(blocks[0].text.text).not.toContain('<@all>')
    expect(blocks[2].elements.map((e: any) => e.value)).toEqual([id, id])
  })
})
