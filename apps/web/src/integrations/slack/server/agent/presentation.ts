import type { ChatStopStreamArguments } from '@slack/web-api'
type KnownBlock = NonNullable<ChatStopStreamArguments['blocks']>[number]
import type { AssistantThreadMessage } from '@/lib/server/domains/assistant/assistant.runtime'
import type {
  AssistantProposedAction,
  AssistantCitation,
} from '@/lib/server/domains/assistant/assistant.toolspec'
export const escapeSlack = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
export function toSlackMrkdwn(value: string): string {
  return escapeSlack(value)
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*(.+?)\*\*/gs, '*$1*')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<$2|$1>')
    .replace(/^\|[\s:|-]+\|\s*$/gm, '')
    .replace(
      /^\|(.+)\|\s*$/gm,
      (_, cells: string) =>
        '• ' +
        cells
          .split('|')
          .map((c) => c.trim())
          .join(' · ')
    )
}

/** Neutralize @-injection; leave standard markdown for chatStream.markdown_text. */
export function formatSlackAnswer(text: string): string {
  return text.replace(/<@/g, '&lt;@').trim()
}

function markdownIsOpen(text: string): boolean {
  if ((text.match(/\*\*/g)?.length ?? 0) % 2) return true
  const link = text.lastIndexOf('](')
  if (link >= 0 && !text.slice(link).includes(')')) return true
  return (text.match(/\[/g)?.length ?? 0) > (text.match(/\]/g)?.length ?? 0)
}

/** Prefix that can be flushed without splitting a markdown construct. */
export function takeSafeMarkdownPrefix(pending: string): string {
  if (!pending) return ''
  let end = pending.lastIndexOf('\n')
  if (end < 0) {
    if (/^\s*[#|]/.test(pending)) return ''
    end = pending.lastIndexOf(' ')
    if (end < 0) return ''
  }
  let candidate = pending.slice(0, end + 1)
  while (candidate && markdownIsOpen(candidate)) {
    const cut = Math.max(
      candidate.lastIndexOf('\n', candidate.length - 2),
      candidate.lastIndexOf(' ', candidate.length - 2)
    )
    if (cut < 0) return ''
    candidate = pending.slice(0, cut + 1)
  }
  return candidate
}

type SlackStreamSink = {
  append(args: { markdown_text: string }): Promise<unknown>
  stop(args?: { markdown_text?: string; blocks?: KnownBlock[] }): Promise<unknown>
}

export function isSlackStoppedByUser(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const data = 'data' in error ? (error as { data?: { error?: string } }).data : undefined
  if (data?.error === 'stopped_by_user') return true
  return error instanceof Error && error.message.includes('stopped_by_user')
}

/**
 * One Slack chatStream, serialized. ChatStreamer is not concurrency-safe:
 * overlapping append() both call startStream and post duplicate messages.
 */
export class SlackReplyStream {
  private pending = ''
  private chain = Promise.resolve()
  private sent = false
  private cancelled = false
  constructor(
    private readonly sink: SlackStreamSink,
    private readonly onStopped?: () => void
  ) {}

  cancel(): void {
    this.cancelled = true
    this.pending = ''
  }

  private noteStopped(): void {
    if (this.cancelled) return
    this.cancel()
    this.onStopped?.()
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.chain.then(work, work)
    this.chain = run.catch(() => undefined)
    return run
  }

  push(delta: string): void {
    if (this.cancelled) return
    this.pending += delta.replace(/<@/g, '&lt;@')
    const safe = takeSafeMarkdownPrefix(this.pending)
    if (!safe) return
    this.pending = this.pending.slice(safe.length)
    this.sent = true
    void this.enqueue(async () => {
      if (this.cancelled) return
      try {
        await this.sink.append({ markdown_text: safe })
      } catch (error) {
        if (isSlackStoppedByUser(error)) {
          this.noteStopped()
          return
        }
        throw error
      }
    })
  }

  async finish(opts: { fallbackText?: string; blocks?: KnownBlock[] }): Promise<void> {
    await this.enqueue(async () => {
      if (this.cancelled) return
      if (this.pending) {
        await this.sink.append({ markdown_text: this.pending })
        this.pending = ''
        this.sent = true
      }
      if (!this.sent && opts.fallbackText) {
        await this.sink.append({ markdown_text: formatSlackAnswer(opts.fallbackText) })
        this.sent = true
      }
      await this.sink.stop({ blocks: opts.blocks })
    })
  }

  /** Drop remaining deltas. Slack already stopped an in-progress stream. */
  async abandon(): Promise<void> {
    this.cancel()
    await this.enqueue(async () => {
      if (!this.sent) return
      await this.sink.stop().catch(() => {})
    })
  }
}
export function mapSlackThread(
  history: Array<{ user?: string; bot_id?: string; text?: string; ts?: string }>,
  trigger: { text?: string; ts?: string; user?: string },
  botUserId: string
): { messages: AssistantThreadMessage[]; contextBlock: string } {
  const strip = (text: string) => text.replaceAll(`<@${botUserId}>`, '').trim()
  const current = strip(trigger.text ?? '').slice(-4000)
  let budget = 4000 - current.length
  const preceding: AssistantThreadMessage[] = []
  for (const entry of history
    .filter((entry) => entry.ts !== trigger.ts)
    .slice(-11)
    .reverse()) {
    if (budget <= 0) break
    const available = Math.max(0, budget - 60)
    if (!available) break
    const content = strip(entry.text ?? '').slice(-available)
    if (!content) continue
    const sender = entry.user === botUserId ? 'assistant' : 'customer'
    const line = sender === 'customer' ? `${entry.user ?? 'Teammate'}: ${content}` : content
    preceding.unshift({ sender, content: line })
    budget -= line.length + 1
  }
  const messages: AssistantThreadMessage[] = []
  for (const message of preceding) {
    const last = messages.at(-1)
    if (last?.sender === 'customer' && message.sender === 'customer')
      last.content += '\n' + message.content
    else messages.push(message)
  }
  messages.push({ sender: 'customer', content: current })
  const contextBlock = messages
    .map((message) => `${message.sender}: ${message.content}`)
    .join('\n')
    .slice(-4000)
  return { messages, contextBlock }
}
export function slackThreadKey(team: string, channel: string, thread: string): string {
  return JSON.stringify([team, channel, thread])
}
export function buildProposalBlocks(
  action: Pick<AssistantProposedAction, 'id' | 'summary'>
): KnownBlock[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: escapeSlack(action.summary).slice(0, 2800) } },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: 'Proposed by Quackback · needs a teammate’s approval' }],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve' },
          action_id: 'qb_action_approve',
          value: action.id,
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Reject' },
          action_id: 'qb_action_reject',
          value: action.id,
        },
      ],
    },
  ]
}
export function replyBlocks(
  citations: AssistantCitation[],
  proposals: AssistantProposedAction[],
  turnId: string,
  identityName: string,
  workspaceName: string,
  baseUrl: string
): KnownBlock[] {
  const sources = citations.slice(0, 5).flatMap((citation) => {
    if (!citation.url) return []
    try {
      const url = new URL(citation.url, baseUrl)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return []
      return [
        `<${escapeSlack(url.href)}|${escapeSlack(citation.title ?? 'Source').replaceAll('|', ' ')}>`,
      ]
    } catch {
      return []
    }
  })
  return [
    ...(sources.length
      ? [
          {
            type: 'context' as const,
            elements: [{ type: 'mrkdwn' as const, text: sources.join(' · ').slice(0, 2900) }],
          },
        ]
      : []),
    ...proposals.slice(0, 10).flatMap(buildProposalBlocks),
    {
      type: 'context_actions',
      elements: [
        {
          type: 'feedback_buttons',
          action_id: 'qb_feedback',
          positive_button: { text: { type: 'plain_text', text: 'Helpful' }, value: `${turnId}:up` },
          negative_button: {
            text: { type: 'plain_text', text: 'Not helpful' },
            value: `${turnId}:down`,
          },
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `AI-generated · ${escapeSlack(identityName)} for ${escapeSlack(workspaceName)}`.slice(
            0,
            2900
          ),
        },
      ],
    },
  ]
}
