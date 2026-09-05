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
/** Stream complete words; hold unfinished Markdown constructs across deltas. */
export class SlackMarkdownStream {
  private pending = ''
  append(delta: string): string {
    this.pending += delta
    let end = this.pending.lastIndexOf('\n')
    if (end < 0) {
      // Headings/tables require a whole line. Ordinary paragraphs should stream
      // immediately rather than waiting for the model to emit a newline.
      if (/^\s*[#|]/.test(this.pending)) return ''
      end = this.pending.lastIndexOf(' ')
      if (end < 0) return ''
      const candidate = this.pending.slice(0, end + 1)
      if (
        (candidate.match(/\*\*/g)?.length ?? 0) % 2 ||
        (candidate.match(/\[/g)?.length ?? 0) !== (candidate.match(/\]\([^)]*\)/g)?.length ?? 0)
      )
        return ''
    }
    const text = this.pending.slice(0, end + 1)
    this.pending = this.pending.slice(end + 1)
    return toSlackMrkdwn(text)
  }
  finish(): string {
    const text = this.pending
    this.pending = ''
    return toSlackMrkdwn(text)
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
