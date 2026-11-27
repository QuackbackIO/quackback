import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button, colors } from './shared-styles'

export interface ConversationAssignedEmailProps {
  /** True when the conversation was assigned to the recipient, false when to their team. */
  assignedToYou: boolean
  /** Name of the customer in the conversation, when known. */
  customerName?: string
  /** Conversation subject or opening line. Empty string suppresses the quote block. */
  preview: string
  /** Admin inbox deep link. */
  conversationUrl: string
  workspaceName: string
  preferencesUrl?: string
  logoUrl?: string
}

export function conversationAssignedHeadline(assignedToYou: boolean): string {
  return assignedToYou
    ? 'A conversation was assigned to you'
    : 'A conversation was assigned to your team'
}

/**
 * Alert for a teammate when a conversation is assigned to them or to a team
 * they belong to.
 *
 * Agent-facing, so there is no unsubscribe token: the only opt-out is the
 * notification-preferences surface, and the footer links straight to it.
 */
export function ConversationAssignedEmail({
  assignedToYou,
  customerName,
  preview,
  conversationUrl,
  workspaceName,
  preferencesUrl,
  logoUrl,
}: ConversationAssignedEmailProps) {
  const headline = conversationAssignedHeadline(assignedToYou)
  const who = customerName ? ` with ${customerName}` : ''
  const lead = assignedToYou
    ? `A conversation${who} was assigned to you.`
    : `A conversation${who} was assigned to your team.`
  const quote = preview.trim()

  return (
    <EmailLayout preview={headline} logoUrl={logoUrl} logoAlt={workspaceName}>
      <Heading style={typography.h1}>{headline}</Heading>
      <Text style={typography.text}>{lead}</Text>

      {quote && (
        <Section
          style={{
            backgroundColor: colors.surfaceMuted,
            borderRadius: '8px',
            padding: '16px 20px',
            marginBottom: '16px',
            borderLeft: `3px solid ${colors.primary}`,
          }}
        >
          <Text style={{ ...typography.text, marginTop: '0', marginBottom: '0' }}>{quote}</Text>
        </Section>
      )}

      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={conversationUrl}>
          Open conversation
        </Button>
      </Section>

      {preferencesUrl ? (
        <NotificationFooter
          reason={`You received this email because a conversation was assigned in ${workspaceName}.`}
          unsubscribeUrl={preferencesUrl}
          unsubscribeLabel="Manage notification preferences"
        />
      ) : (
        <Text style={typography.footer}>
          You received this email because a conversation was assigned in {workspaceName}.
        </Text>
      )}
    </EmailLayout>
  )
}
