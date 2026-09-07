import { describe, it, expect } from 'vitest'
import { generateId } from '@quackback/ids'
import {
  mapSlackThread,
  toSlackMrkdwn,
  buildProposalBlocks,
  formatSlackAnswer,
  takeSafeMarkdownPrefix,
  SlackReplyStream,
  isSlackStoppedByUser,
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
  it('keeps a bulleted feedback list intact', () => {
    const text = toSlackMrkdwn(
      'Here are the items:\n\n• **Roadmap timeline (10)** (146 votes)\n• **Mobile notifications (6)** (53 votes)\n'
    )
    expect(text).toContain('• *Roadmap timeline (10)* (146 votes)')
    expect(text).toContain('• *Mobile notifications (6)* (53 votes)')
  })

  it('leaves standard markdown links for chatStream and only strips mention injection', () => {
    const formatted = formatSlackAnswer(
      [
        '• [Linear integration (10)](https://example.com/p3) · 291 votes',
        '• Gantt chart view (341 votes)',
        'cc <@U123>',
      ].join('\n')
    )
    expect(formatted).toContain('• [Linear integration (10)](https://example.com/p3) · 291 votes')
    expect(formatted).toContain('• Gantt chart view (341 votes)')
    expect(formatted).toContain('cc &lt;@U123>')
    expect(formatted).not.toContain('<@U123>')
  })

  it('holds incomplete markdown links and bold until they close', () => {
    expect(takeSafeMarkdownPrefix('The next ')).toBe('The next ')
    expect(takeSafeMarkdownPrefix('[Import from CSV (3)](https://example.com/p')).toBe('')
    expect(takeSafeMarkdownPrefix('[Import from CSV (3)](https://example.com/p1) more ')).toBe(
      '[Import from CSV (3)](https://example.com/p1) more '
    )
    expect(takeSafeMarkdownPrefix('**bo')).toBe('')
    expect(takeSafeMarkdownPrefix('**bold** done ')).toBe('**bold** done ')
  })

  it('serializes Slack stream appends so overlapping flushes cannot start two streams', async () => {
    let inflight = 0
    let max = 0
    const chunks: string[] = []
    const stream = new SlackReplyStream({
      async append({ markdown_text }) {
        inflight += 1
        max = Math.max(max, inflight)
        await new Promise((resolve) => setTimeout(resolve, 15))
        chunks.push(markdown_text)
        inflight -= 1
      },
      async stop() {
        inflight += 1
        max = Math.max(max, inflight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inflight -= 1
      },
    })
    stream.push('The highest-voted ')
    stream.push('feedback is ')
    stream.push('[Import from CSV (3)](https://example.com/')
    stream.push('post_01abc) ')
    stream.push('done.\n')
    await stream.finish({ blocks: [] })
    expect(max).toBe(1)
    expect(chunks.join('')).toContain('[Import from CSV (3)](https://example.com/post_01abc)')
    expect(chunks.join('')).toContain('done.')
  })

  it('treats Slack stopped_by_user as a user stop', () => {
    expect(isSlackStoppedByUser({ data: { error: 'stopped_by_user' } })).toBe(true)
    expect(isSlackStoppedByUser(new Error('stopped_by_user'))).toBe(true)
    expect(isSlackStoppedByUser({ data: { error: 'channel_not_found' } })).toBe(false)
  })

  it('stops appending after cancel and does not start a stream on abandon if nothing was sent', async () => {
    const appends: string[] = []
    let stops = 0
    const stream = new SlackReplyStream({
      async append({ markdown_text }) {
        appends.push(markdown_text)
      },
      async stop() {
        stops += 1
      },
    })
    stream.cancel()
    stream.push('hello world\n')
    await stream.abandon()
    expect(appends).toEqual([])
    expect(stops).toBe(0)
  })

  it('aborts the turn when Slack reports the stream was stopped by the user', async () => {
    const stopped = new Promise<void>((resolve) => {
      const stream = new SlackReplyStream(
        {
          async append() {
            throw { data: { error: 'stopped_by_user' } }
          },
          async stop() {},
        },
        resolve
      )
      stream.push('hello world\n')
    })
    await stopped
  })

  it('buttons contain only the pending-action id', () => {
    const id = generateId('assistant_action')
    const blocks = buildProposalBlocks({ id, summary: 'Create feedback <@all>' }) as any[]
    expect(blocks[0].text.text).not.toContain('<@all>')
    expect(blocks[2].elements.map((e: any) => e.value)).toEqual([id, id])
  })
})
