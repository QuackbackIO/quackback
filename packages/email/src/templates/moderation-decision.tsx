import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button, colors } from './shared-styles'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

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
  i18n?: EmailLocale
}

export const MODERATION_DECISION_MESSAGES = defineEmailMessages({
  commentApproved: {
    id: 'email.moderation.commentApproved',
    defaultMessage: 'Your comment is now public',
  },
  commentRejected: {
    id: 'email.moderation.commentRejected',
    defaultMessage: 'Your comment was not published',
  },
  postApproved: { id: 'email.moderation.postApproved', defaultMessage: 'Your post is now public' },
  postRejected: {
    id: 'email.moderation.postRejected',
    defaultMessage: 'Your post was not published',
  },
  commentApprovedBody: {
    id: 'email.moderation.commentApprovedBody',
    defaultMessage: 'The {workspace} team reviewed your comment on this post and published it.',
  },
  commentRejectedBody: {
    id: 'email.moderation.commentRejectedBody',
    defaultMessage:
      'The {workspace} team reviewed your comment on this post and decided not to publish it.',
  },
  postApprovedBody: {
    id: 'email.moderation.postApprovedBody',
    defaultMessage: 'The {workspace} team reviewed your post and published it.',
  },
  postRejectedBody: {
    id: 'email.moderation.postRejectedBody',
    defaultMessage: 'The {workspace} team reviewed your post and decided not to publish it.',
  },
  commentReason: {
    id: 'email.moderation.commentReason',
    defaultMessage: 'You received this email because you wrote this comment on {workspace}.',
  },
  postReason: {
    id: 'email.moderation.postReason',
    defaultMessage: 'You received this email because you wrote this post on {workspace}.',
  },
  viewComment: { id: 'email.moderation.viewComment', defaultMessage: 'View comment' },
  viewPost: { id: 'email.moderation.viewPost', defaultMessage: 'View post' },
})
const M = MODERATION_DECISION_MESSAGES

/** The heading, which is also the subject line. */
export function moderationDecisionHeadline(
  item: ModeratedItem,
  decision: ModerationDecision,
  i18n: EmailLocale = ENGLISH_EMAIL
): string {
  if (item === 'comment')
    return i18n.t(decision === 'approved' ? M.commentApproved : M.commentRejected)
  return i18n.t(decision === 'approved' ? M.postApproved : M.postRejected)
}

function bodyLine(
  item: ModeratedItem,
  decision: ModerationDecision,
  workspaceName: string,
  i18n: EmailLocale
) {
  const message =
    item === 'comment'
      ? decision === 'approved'
        ? M.commentApprovedBody
        : M.commentRejectedBody
      : decision === 'approved'
        ? M.postApprovedBody
        : M.postRejectedBody
  return i18n.t(message, { workspace: workspaceName })
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
  i18n = ENGLISH_EMAIL,
}: ModerationDecisionEmailProps) {
  const { t } = i18n
  const headline = moderationDecisionHeadline(item, decision, i18n)
  const reason = t(item === 'comment' ? M.commentReason : M.postReason, {
    workspace: workspaceName,
  })

  return (
    <EmailLayout preview={headline} logoUrl={logoUrl} logoAlt={workspaceName} i18n={i18n}>
      <Heading style={typography.h1}>{headline}</Heading>
      <Text style={typography.text}>{bodyLine(item, decision, workspaceName, i18n)}</Text>

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
            {t(item === 'comment' ? M.viewComment : M.viewPost)}
          </Button>
        </Section>
      ) : null}

      {unsubscribeUrl ? (
        <NotificationFooter
          reason={reason}
          unsubscribeUrl={unsubscribeUrl}
          preferencesUrl={preferencesUrl}
          i18n={i18n}
        />
      ) : (
        <Text style={typography.footer}>{reason}</Text>
      )}
    </EmailLayout>
  )
}
