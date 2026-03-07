/**
 * Quality gate prompt — cheap LLM pre-classifier.
 *
 * Decides whether raw feedback content contains actionable product
 * feedback worth extracting signals from. Filters out routine support
 * conversations, greetings, spam, and off-topic messages.
 *
 * For channel-monitored items, the prompt also asks for a suggested title.
 */

import type { RawFeedbackContent, RawFeedbackItemContextEnvelope } from '../../types'

function getIngestionMode(context: RawFeedbackItemContextEnvelope): string | undefined {
  return (context.metadata as Record<string, unknown> | undefined)?.ingestionMode as
    | string
    | undefined
}

export function buildQualityGatePrompt(input: {
  sourceType: string
  content: RawFeedbackContent
  context: RawFeedbackItemContextEnvelope
}): string {
  const contentText = [input.content.subject, input.content.text].filter(Boolean).join('\n')
  const isChannelMonitor = getIngestionMode(input.context) === 'channel_monitor'

  // Include thread context for conversational sources so the model
  // can see whether the customer expressed product feedback
  let threadSection = ''
  if (input.context.thread && input.context.thread.length > 0) {
    const customerMessages = input.context.thread
      .filter((m) => m.role === 'customer')
      .slice(-5)
      .map((m) => m.text)
      .join('\n---\n')
    if (customerMessages) {
      threadSection = `\n<customer_messages>\n${customerMessages}\n</customer_messages>`
    }
  }

  const responseFormat = isChannelMonitor
    ? '{ "extract": true/false, "reason": "brief explanation", "suggestedTitle": "short title if extract is true" }'
    : '{ "extract": true/false, "reason": "brief explanation" }'

  const channelMonitorContext = isChannelMonitor
    ? `
IMPORTANT: This message was passively collected from a monitored Slack channel.
Be STRICT — most messages will be casual conversation, not feedback.
Only extract if the message contains genuine product feedback.
REJECT: greetings, coordination, meeting scheduling, social chat, reactions to other messages, how-to questions, status updates, links without commentary.
If you extract, also provide a concise "suggestedTitle" (under 80 chars) summarizing the feedback.`
    : ''

  return `You are a quality gate for a product feedback pipeline.
Decide whether this content contains actionable product feedback worth analyzing.

Return strict JSON only:
${responseFormat}
${channelMonitorContext}
EXTRACT (true) if the content contains:
- Feature requests or product suggestions
- Bug reports or error descriptions
- Usability issues or UX frustrations
- Complaints about product behavior or missing capabilities
- Churn signals mentioning switching to competitors or cancellation
- Praise about specific product features (useful for understanding what works)

REJECT (false) if the content is:
- Routine support: password resets, billing questions, account access, how-to queries
- General greetings, thanks, or pleasantries without product substance
- Spam, test messages, or empty/gibberish content
- Agent-only messages or internal notes without customer feedback
- Off-topic conversations unrelated to the product
- Questions that are purely informational with no implicit product need

Source type "${input.sourceType}" context:
- Widget/API submissions: high intent — users chose to submit feedback
- Intercom/Zendesk/email: mixed — could be support or feedback, look for explicit product needs
- Slack: mixed — look for discussions about the product, not general chat

<content>
${contentText}
</content>${threadSection}`
}
