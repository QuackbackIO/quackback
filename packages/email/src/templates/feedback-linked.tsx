import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button, colors } from './shared-styles'
import { aPostNoun, postNoun, type PostWord } from '../post-word'

interface FeedbackLinkedEmailProps {
  recipientName?: string
  postTitle: string
  postUrl: string
  workspaceName: string
  unsubscribeUrl: string
  preferencesUrl?: string
  attributedByName?: string
  logoUrl?: string
  /** What visitors call what they post; idea when not given. */
  postWord?: PostWord
}

export function FeedbackLinkedEmail({
  recipientName,
  postTitle,
  postUrl,
  workspaceName,
  unsubscribeUrl,
  preferencesUrl,
  attributedByName,
  logoUrl,
  postWord,
}: FeedbackLinkedEmailProps) {
  const noun = postNoun(postWord)
  const greeting = recipientName ? `Thanks ${recipientName}!` : 'Thanks!'
  const attribution = attributedByName
    ? ` ${attributedByName} from the ${workspaceName} team has linked your feedback to ${aPostNoun(postWord)}.`
    : ` Your feedback has been linked to ${aPostNoun(postWord)} on ${workspaceName}.`

  return (
    <EmailLayout
      preview={`Your feedback has been linked to "${postTitle}"`}
      logoUrl={logoUrl}
      logoAlt={workspaceName}
    >
      {/* Content */}
      <Heading style={typography.h1}>Your feedback is being tracked!</Heading>
      <Text style={typography.text}>
        {greeting}
        {attribution} You'll receive updates when the status changes or new comments are posted.
      </Text>

      {/* Post Title */}
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
      </Section>

      {/* CTA Button */}
      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={postUrl}>
          View {noun}
        </Button>
      </Section>

      {/* Footer */}
      <NotificationFooter
        reason={`You received this email because your feedback was attributed to this ${noun}.`}
        unsubscribeUrl={unsubscribeUrl}
        preferencesUrl={preferencesUrl}
      />
    </EmailLayout>
  )
}
