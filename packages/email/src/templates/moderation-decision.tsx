import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button, colors } from './shared-styles'

export type ModerationDecision = 'approved' | 'rejected'
export type ModeratedItem = 'post' | 'comment'

export interface ModerationDecisionEmailProps {
  item: ModeratedItem
  decision: ModerationDecision
  /** The post's title; for a comment, the post it was written on. */
  postTitle: string
  /** Where the approved item now shows. Absent for a rejection: it is gone. */
  postUrl?: string
  workspaceName: string
  unsubscribeUrl?: string
  preferencesUrl?: string
  logoUrl?: string
}

/** The heading, which is also the subject line. */
export function moderationDecisionHeadline(
  item: ModeratedItem,
  decision: ModerationDecision
): string {
  if (item === 'comment') {
    return decision === 'approved' ? 'Your comment is now public' : 'Your comment was not published'
  }
  return decision === 'approved' ? 'Your post is now public' : 'Your post was not published'
}

function bodyLine(item: ModeratedItem, decision: ModerationDecision, workspaceName: string) {
  const subject = item === 'comment' ? 'your comment on this post' : 'your post'
  return decision === 'approved'
    ? `The ${workspaceName} team reviewed ${subject} and published it.`
    : `The ${workspaceName} team reviewed ${subject} and decided not to publish it.`
}

export function ModerationDecisionEmail({
  item,
  decision,
  postTitle,
  postUrl,
  workspaceName,
  unsubscribeUrl,
  preferencesUrl,
  logoUrl,
}: ModerationDecisionEmailProps) {
  const headline = moderationDecisionHeadline(item, decision)
  const reason = `You received this email because you wrote this ${item} on ${workspaceName}.`

  return (
    <EmailLayout preview={headline} logoUrl={logoUrl} logoAlt={workspaceName}>
      <Heading style={typography.h1}>{headline}</Heading>
      <Text style={typography.text}>{bodyLine(item, decision, workspaceName)}</Text>

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

      {decision === 'approved' && postUrl ? (
        <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
          <Button style={button.primary} href={postUrl}>
            {item === 'comment' ? 'View comment' : 'View post'}
          </Button>
        </Section>
      ) : null}

      {unsubscribeUrl ? (
        <NotificationFooter
          reason={reason}
          unsubscribeUrl={unsubscribeUrl}
          preferencesUrl={preferencesUrl}
        />
      ) : (
        <Text style={typography.footer}>{reason}</Text>
      )}
    </EmailLayout>
  )
}
