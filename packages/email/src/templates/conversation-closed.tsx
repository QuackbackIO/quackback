import { Body, Head, Html, Preview, Text } from '@react-email/components'
import { ENGLISH_EMAIL, type EmailLocale } from '../i18n'
import { CSAT_MESSAGES as M } from './csat-request'

export interface ConversationClosedEmailProps {
  workspaceName: string
  variant: 'closed' | 'auto_closed'
  viewUrl?: string
  csatPrompt?: string
  ratingUrls?: readonly [string, string, string, string, string]
  i18n?: EmailLocale
}

const CSAT_FACES = ['😞', '🙁', '😐', '🙂', '😄'] as const

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

const muted: React.CSSProperties = {
  color: '#667085',
  fontSize: '13px',
  lineHeight: '1.55',
}

export function ConversationClosedEmail({
  workspaceName,
  variant,
  viewUrl,
  csatPrompt,
  ratingUrls,
  i18n = ENGLISH_EMAIL,
}: ConversationClosedEmailProps) {
  const { t } = i18n
  const intro =
    variant === 'auto_closed' ? t(M.autoClosed) : t(M.closed, { workspace: workspaceName })
  const followUp = t(variant === 'auto_closed' ? M.followUpAutoClosed : M.followUpClosed)

  return (
    <Html lang={i18n.lang} dir={i18n.dir}>
      <Head />
      <Preview>{intro}</Preview>
      <Body style={page}>
        <Text
          style={{ margin: '0 0 13px', color: '#1d2939', fontSize: '15px', lineHeight: '1.65' }}
        >
          {intro}
        </Text>
        {ratingUrls ? (
          <>
            <Text style={{ margin: '20px 0 8px', color: '#1d2939', fontSize: '15px' }}>
              {csatPrompt || t(M.heading)}
            </Text>
            <Text style={{ margin: '0 0 16px', fontSize: '28px', letterSpacing: '8px' }}>
              {CSAT_FACES.map((face, i) => (
                <a key={face} href={ratingUrls[i]} style={{ textDecoration: 'none' }}>
                  {face}
                </a>
              ))}
            </Text>
          </>
        ) : null}
        <Text style={muted}>{followUp}</Text>
        {viewUrl ? (
          <Text style={muted}>
            <a href={viewUrl} style={{ color: '#667085' }}>
              {t(M.viewOnline)}
            </a>
          </Text>
        ) : null}
      </Body>
    </Html>
  )
}
