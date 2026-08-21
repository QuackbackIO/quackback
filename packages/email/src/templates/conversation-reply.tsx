import { Body, Head, Html, Link, Preview, Text } from '@react-email/components'

/**
 * Human correspondence for the email channel: the agent's words are the body.
 * No layout card, logo, heading, intro, quote box, or unsubscribe.
 */
export interface ConversationReplyEmailProps {
  /** Sanitized HTML of the agent's message. */
  bodyHtml?: string
  /** Plain fallback when there is no rendered body. */
  messagePreview: string
  agentName: string
  /** Second signature line: team or workspace name. */
  teamName: string
  /** Portal or widget deep link; omitted when the visitor has no web surface. */
  viewUrl?: string
  quotedPrevious?: {
    date: Date | string
    name: string
    text: string
  }
}

const page: React.CSSProperties = {
  backgroundColor: '#ffffff',
  color: '#1d2939',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontSize: '15px',
  lineHeight: '1.65',
  margin: 0,
  padding: '24px 8px 32px',
}

const body: React.CSSProperties = {
  color: '#1d2939',
  fontSize: '15px',
  lineHeight: '1.65',
}

const sigName: React.CSSProperties = {
  color: '#1d2939',
  fontSize: '15px',
  lineHeight: '1.65',
  margin: '20px 0 0',
}

const sigTeam: React.CSSProperties = {
  color: '#1d2939',
  fontSize: '15px',
  lineHeight: '1.65',
  margin: '0 0 20px',
}

const rule: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid #e2e7ee',
  margin: '0 0 12px',
}

const footer: React.CSSProperties = {
  color: '#667085',
  fontSize: '12px',
  lineHeight: '1.55',
  margin: '0 0 20px',
}

const footerLink: React.CSSProperties = {
  color: '#667085',
  fontSize: '12px',
  textDecoration: 'underline',
}

const quote: React.CSSProperties = {
  color: '#98a2b3',
  fontSize: '13px',
  lineHeight: '1.55',
  margin: '0',
}

function formatQuoteDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function quoteExcerpt(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= 500) return trimmed
  return `${trimmed.slice(0, 499).trimEnd()}…`
}

export function ConversationReplyEmail({
  bodyHtml,
  messagePreview,
  agentName,
  teamName,
  viewUrl,
  quotedPrevious,
}: ConversationReplyEmailProps) {
  const preview = messagePreview.slice(0, 140)
  const quoteDate = quotedPrevious ? formatQuoteDate(quotedPrevious.date) : ''

  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={page}>
        {bodyHtml ? (
          <div style={body} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        ) : (
          <Text style={{ ...body, margin: '0 0 13px' }}>{messagePreview}</Text>
        )}

        <Text style={sigName}>{agentName}</Text>
        <Text style={sigTeam}>{teamName}</Text>

        <hr style={rule} />

        <Text style={footer}>
          Reply to this email to continue the conversation
          {viewUrl ? (
            <>
              {' · '}
              <Link href={viewUrl} style={footerLink}>
                View it online
              </Link>
            </>
          ) : null}
        </Text>

        {quotedPrevious ? (
          <Text style={quote}>
            On {quoteDate}
            {quoteDate ? ', ' : ''}
            {quotedPrevious.name} wrote:
            <br />
            {quoteExcerpt(quotedPrevious.text)}
          </Text>
        ) : null}
      </Body>
    </Html>
  )
}
