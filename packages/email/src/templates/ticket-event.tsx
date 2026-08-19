import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button, colors } from './shared-styles'

interface TicketEventEmailProps {
  heading: string
  intro: string
  /**
   * The full message body as plain text (a reply's markdown rendered to
   * text). Split on blank lines into paragraphs; React escaping keeps it
   * inert. Absent for kinds with no message (status, assignment, SLA).
   */
  messageBody?: string
  /** Attributed sender for the message block (reply kind). */
  authorName?: string
  /** Stage transition chip pair (status kinds only). */
  statusChange?: { previousLabel: string | null; newLabel: string }
  /** One-line highlighted fact (SLA kinds: clock + due time). */
  factLine?: string
  /** Secondary sentence under the intro (e.g. reply-reopens note). */
  note?: string
  ctaUrl: string
  ctaLabel: string
  organizationName: string
  reason: string
  preferencesUrl?: string
  logoUrl?: string
}

/**
 * The single template behind every ticket lifecycle email; per-kind copy
 * lives in ticketEventCopy() (index.ts). Optional blocks render only when
 * their facts are present, mirroring conversation-message.tsx.
 */
export function TicketEventEmail({
  heading,
  intro,
  messageBody,
  authorName,
  statusChange,
  factLine,
  note,
  ctaUrl,
  ctaLabel,
  organizationName,
  reason,
  preferencesUrl,
  logoUrl,
}: TicketEventEmailProps) {
  const paragraphs = messageBody
    ? messageBody
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
    : []

  return (
    <EmailLayout preview={heading} logoUrl={logoUrl} logoAlt={organizationName}>
      <Heading style={typography.h1}>{heading}</Heading>
      <Text style={typography.text}>{intro}</Text>

      {paragraphs.length > 0 && (
        <Section
          style={{
            backgroundColor: colors.surfaceMuted,
            borderRadius: '8px',
            padding: '16px 20px',
            marginBottom: '16px',
            borderLeft: `3px solid ${colors.primary}`,
          }}
        >
          {authorName && (
            <Text
              style={{
                ...typography.textSmall,
                marginTop: '0',
                marginBottom: '4px',
                color: colors.textMuted,
              }}
            >
              {authorName}
            </Text>
          )}
          {paragraphs.map((p, i) => (
            <Text
              key={i}
              style={{
                ...typography.text,
                marginTop: i === 0 ? '0' : '8px',
                marginBottom: '0',
              }}
            >
              {p}
            </Text>
          ))}
        </Section>
      )}

      {statusChange && (
        <Text style={{ ...typography.text, color: colors.textMuted }}>
          {statusChange.previousLabel
            ? `${statusChange.previousLabel} → ${statusChange.newLabel}`
            : statusChange.newLabel}
        </Text>
      )}

      {factLine && (
        <Section
          style={{
            backgroundColor: colors.surfaceMuted,
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
          }}
        >
          <Text style={{ ...typography.text, marginTop: '0', marginBottom: '0' }}>{factLine}</Text>
        </Section>
      )}

      {note && <Text style={{ ...typography.textSmall, color: colors.textMuted }}>{note}</Text>}

      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={ctaUrl}>
          {ctaLabel}
        </Button>
      </Section>

      <NotificationFooter
        reason={reason}
        unsubscribeUrl={preferencesUrl ?? ctaUrl}
        unsubscribeLabel="Manage notification preferences"
      />
    </EmailLayout>
  )
}
