import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button, colors } from './shared-styles'

/**
 * A reviewed update to a customer whose conversation is linked to a post.
 *
 * The body is written by the reviewer who decided to send it, so this template
 * carries their words rather than composing a claim of its own. It promises
 * nothing about future updates: a follow-up is one deliberate send, not a
 * subscription.
 */
interface PostUpdateEmailProps {
  recipientName?: string
  postTitle: string
  postUrl: string
  /** The reviewer's own message, plain text. */
  message: string
  /** The post's current status, when it has one worth naming. */
  statusLabel?: string
  workspaceName: string
  unsubscribeUrl: string
  preferencesUrl?: string
  logoUrl?: string
}

export function PostUpdateEmail({
  recipientName,
  postTitle,
  postUrl,
  message,
  statusLabel,
  workspaceName,
  unsubscribeUrl,
  preferencesUrl,
  logoUrl,
}: PostUpdateEmailProps) {
  return (
    <EmailLayout preview={`An update on "${postTitle}"`} logoUrl={logoUrl} logoAlt={workspaceName}>
      <Heading style={typography.h1}>An update on something you asked for</Heading>
      <Text style={typography.text}>{recipientName ? `Hi ${recipientName},` : 'Hi,'}</Text>
      <Text style={typography.text}>{message}</Text>

      <Section
        style={{
          backgroundColor: colors.surfaceMuted,
          borderRadius: '8px',
          padding: '16px 20px',
          marginBottom: '24px',
        }}
      >
        <Text style={{ ...typography.text, marginTop: '0', marginBottom: '0', fontWeight: '600' }}>
          {postTitle}
        </Text>
        {statusLabel && (
          <Text style={{ ...typography.textSmall, marginTop: '4px', marginBottom: '0' }}>
            {statusLabel}
          </Text>
        )}
      </Section>

      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={postUrl}>
          View the request
        </Button>
      </Section>

      <NotificationFooter
        reason={`You received this because you asked ${workspaceName} about this.`}
        unsubscribeUrl={unsubscribeUrl}
        preferencesUrl={preferencesUrl}
      />
    </EmailLayout>
  )
}
