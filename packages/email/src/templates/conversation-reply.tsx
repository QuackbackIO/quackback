import { Body, Head, Html, Link, Preview, Text } from '@react-email/components'
import { ENGLISH_EMAIL, type EmailLocale } from '../i18n'
import { CONVERSATION_MESSAGES as M } from '../conversation-copy'

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
  /** Second signature line: team or workspace name. Omitted when the first
   *  line already names the team. */
  teamName?: string
  /** Portal or widget deep link; omitted when the visitor has no web surface. */
  viewUrl?: string
  quotedPrevious?: {
    date: Date | string
    name: string
    text: string
  }
  i18n?: EmailLocale
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

function formatQuoteDate(value: Date | string, lang: string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(lang === 'en' ? 'en-US' : lang, { month: 'short', day: 'numeric' })
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
  i18n = ENGLISH_EMAIL,
}: ConversationReplyEmailProps) {
  const { t } = i18n
  const preview = messagePreview.slice(0, 140)
  const quoteDate = quotedPrevious ? formatQuoteDate(quotedPrevious.date, i18n.lang) : ''

  return (
    <Html lang={i18n.lang} dir={i18n.dir}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={page}>
        {bodyHtml ? (
          <div style={body} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        ) : (
          <Text style={{ ...body, margin: '0 0 13px' }}>{messagePreview}</Text>
        )}

        <Text style={sigName}>{agentName}</Text>
        {teamName ? <Text style={sigTeam}>{teamName}</Text> : null}

        <hr style={rule} />

        <Text style={footer}>
          {t(M.continueByReply)}
          {viewUrl ? (
            <>
              {' · '}
              <Link href={viewUrl} style={footerLink}>
                {t(M.viewOnline)}
              </Link>
            </>
          ) : null}
        </Text>

        {quotedPrevious ? (
          <Text style={quote}>
            {quoteDate
              ? t(M.quoteWithDate, { date: quoteDate, name: quotedPrevious.name })
              : t(M.quote, { name: quotedPrevious.name })}
            <br />
            {quoteExcerpt(quotedPrevious.text)}
          </Text>
        ) : null}
      </Body>
    </Html>
  )
}
