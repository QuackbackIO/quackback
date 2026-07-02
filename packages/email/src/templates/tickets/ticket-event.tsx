/**
 * Generic ticket-event email template.
 *
 * One template covers all 8 ticket events + 2 SLA events. The caller is
 * responsible for the title/body copy — this component handles layout,
 * branding, the CTA and the unsubscribe footer.
 */

import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from '../email-layout'
import { typography, button, colors } from '../shared-styles'

export interface TicketEventDetail {
  label: string
  value: string
}

export interface TicketEventContentSection {
  title: string
  body?: string
  rows?: TicketEventDetail[]
  tone?: 'default' | 'quote' | 'warning'
}

export interface TicketEventEmailProps {
  /** Headline shown at the top of the email body. */
  title: string
  /** Optional body paragraph rendered between the headline and the CTA. */
  body?: string
  /** Concise explanation of what changed and why the recipient is seeing this. */
  summary?: string
  /** Human-readable event category, e.g. "Status changed". */
  eventLabel?: string
  /** Actor name when available and safe to show. */
  actorName?: string
  /** ISO or preformatted timestamp for the event. */
  occurredAt?: string
  /** Structured event-specific details. */
  details?: TicketEventDetail[]
  /** Rich action-specific content that explains the event without opening the ticket. */
  contentSections?: TicketEventContentSection[]
  /** Optional quoted ticket reply/update preview. */
  quote?: string
  /** Ticket subject. Surfaced as a labelled card below the headline. */
  ticketSubject: string
  /** Direct link to the ticket in the agent UI. */
  ticketUrl: string
  /** Workspace label for branding + the footer. */
  organizationName: string
  /** Per-recipient unsubscribe / preferences link. */
  unsubscribeUrl: string
  logoUrl?: string
  /** Status label (e.g. "open", "solved") shown next to the ticket subject. */
  statusLabel?: string
  /** Priority label (e.g. "high", "urgent"). */
  priorityLabel?: string
}

export function TicketEventEmail({
  title,
  body,
  summary,
  eventLabel,
  actorName,
  occurredAt,
  details = [],
  contentSections = [],
  quote,
  ticketSubject,
  ticketUrl,
  organizationName,
  unsubscribeUrl,
  logoUrl,
  statusLabel,
  priorityLabel,
}: TicketEventEmailProps) {
  const meta = [statusLabel, priorityLabel].filter(Boolean).join(' · ')
  const context = [eventLabel, actorName ? `by ${actorName}` : undefined, occurredAt]
    .filter(Boolean)
    .join(' · ')
  const message = summary ?? body

  return (
    <EmailLayout preview={title} logoUrl={logoUrl} logoAlt={organizationName}>
      <Heading style={typography.h1}>{title}</Heading>
      {context ? (
        <Text style={{ ...typography.textSmall, color: colors.textMuted }}>{context}</Text>
      ) : null}
      {message ? <Text style={typography.text}>{message}</Text> : null}

      {contentSections.length > 0 ? (
        <Section style={{ marginTop: '20px', marginBottom: '16px' }}>
          <Text style={{ ...typography.text, fontWeight: '600', margin: '0 0 12px' }}>
            Action content
          </Text>
          {contentSections.map((section) => (
            <Section
              key={section.title}
              style={{
                backgroundColor:
                  section.tone === 'warning'
                    ? '#FEF3C7'
                    : section.tone === 'quote'
                      ? colors.surfaceMuted
                      : '#FFFFFF',
                border: `1px solid ${colors.border}`,
                borderLeft:
                  section.tone === 'quote'
                    ? `4px solid ${colors.border}`
                    : `1px solid ${colors.border}`,
                borderRadius: '8px',
                padding: '14px 18px',
                marginBottom: '12px',
              }}
            >
              <Text style={{ ...typography.textSmall, fontWeight: '600', margin: '0 0 8px' }}>
                {section.title}
              </Text>
              {section.body ? (
                <Text style={{ ...typography.text, whiteSpace: 'pre-wrap', margin: '0 0 10px' }}>
                  {section.body}
                </Text>
              ) : null}
              {section.rows?.map((row) => (
                <Text
                  key={`${section.title}-${row.label}`}
                  style={{ ...typography.textSmall, margin: '0 0 8px' }}
                >
                  <strong>{row.label}:</strong> {row.value}
                </Text>
              ))}
            </Section>
          ))}
        </Section>
      ) : null}

      <Section
        style={{
          backgroundColor: colors.surfaceMuted,
          borderRadius: '8px',
          padding: '16px 20px',
          marginBottom: '16px',
        }}
      >
        <Text
          style={{
            ...typography.textSmall,
            marginTop: '0',
            marginBottom: '4px',
            color: colors.textMuted,
          }}
        >
          Ticket
        </Text>
        <Text style={{ ...typography.text, marginTop: '0', marginBottom: '0', fontWeight: '600' }}>
          {ticketSubject}
        </Text>
        {meta ? (
          <Text
            style={{
              ...typography.textSmall,
              marginTop: '4px',
              marginBottom: '0',
              color: colors.textMuted,
            }}
          >
            {meta}
          </Text>
        ) : null}
      </Section>

      {details.length > 0 ? (
        <Section
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            padding: '16px 20px',
            marginBottom: '16px',
          }}
        >
          <Text style={{ ...typography.textSmall, fontWeight: '600', margin: '0 0 10px' }}>
            Current ticket
          </Text>
          {details.map((detail) => (
            <Text key={detail.label} style={{ ...typography.textSmall, margin: '0 0 8px' }}>
              <strong>{detail.label}:</strong> {detail.value}
            </Text>
          ))}
        </Section>
      ) : null}

      {quote ? (
        <Section
          style={{
            borderLeft: `4px solid ${colors.border}`,
            paddingLeft: '16px',
            marginBottom: '16px',
          }}
        >
          <Text style={{ ...typography.text, color: colors.textMuted }}>{quote}</Text>
        </Section>
      ) : null}

      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={ticketUrl}>
          View Ticket
        </Button>
      </Section>

      <NotificationFooter
        reason="You received this email because you are subscribed to this ticket."
        unsubscribeUrl={unsubscribeUrl}
      />
    </EmailLayout>
  )
}
