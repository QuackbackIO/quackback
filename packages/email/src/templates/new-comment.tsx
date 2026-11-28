import { Button, Column, Heading, Row, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter, feedbackFooterReason } from './email-layout'
import { typography, button, colors } from './shared-styles'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

export const NEW_COMMENT_MESSAGES = defineEmailMessages({
  subject: { id: 'email.newComment.subject', defaultMessage: 'New comment on "{post}"' },
  headingAuthor: {
    id: 'email.newComment.headingAuthor',
    defaultMessage: 'New comment on your feedback',
  },
  headingFollower: {
    id: 'email.newComment.headingFollower',
    defaultMessage: 'New comment on a post you follow',
  },
  bodyAuthor: {
    id: 'email.newComment.bodyAuthor',
    defaultMessage: '{name} commented on your feedback in {workspace}.',
  },
  bodyFollower: {
    id: 'email.newComment.bodyFollower',
    defaultMessage: '{name} commented on a post you follow in {workspace}.',
  },
  team: { id: 'email.newComment.team', defaultMessage: '{name} (Team)' },
  postLabel: { id: 'email.newComment.postLabel', defaultMessage: 'Feedback' },
  cta: { id: 'email.newComment.cta', defaultMessage: 'View comment' },
})
const M = NEW_COMMENT_MESSAGES

interface NewCommentEmailProps {
  postTitle: string
  postUrl: string
  commenterName: string
  commentPreview: string
  isTeamMember: boolean
  organizationName: string
  unsubscribeUrl: string
  preferencesUrl?: string
  logoUrl?: string
  /** The reader wrote the post. Everyone else follows it (voted, commented or subscribed). */
  isPostAuthor?: boolean
  i18n?: EmailLocale
}

export function NewCommentEmail({
  postTitle,
  postUrl,
  commenterName,
  commentPreview,
  isTeamMember,
  organizationName,
  unsubscribeUrl,
  preferencesUrl,
  logoUrl,
  isPostAuthor = false,
  i18n = ENGLISH_EMAIL,
}: NewCommentEmailProps) {
  const { t } = i18n
  const name = isTeamMember ? t(M.team, { name: commenterName }) : commenterName
  return (
    <EmailLayout
      preview={t(M.subject, { post: postTitle })}
      logoUrl={logoUrl}
      logoAlt={organizationName}
      i18n={i18n}
    >
      {/* Content */}
      <Heading style={typography.h1}>
        {t(isPostAuthor ? M.headingAuthor : M.headingFollower)}
      </Heading>
      <Text style={typography.text}>
        {t(isPostAuthor ? M.bodyAuthor : M.bodyFollower, { name, workspace: organizationName })}
      </Text>

      {/* Post Title */}
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
          {t(M.postLabel)}
        </Text>
        <Text style={{ ...typography.text, marginTop: '0', marginBottom: '0', fontWeight: '600' }}>
          {postTitle}
        </Text>
      </Section>

      {/* Comment Preview - using Row/Column instead of border-left for Outlook compatibility */}
      <Row style={{ marginBottom: '24px' }}>
        <Column style={{ width: '3px', backgroundColor: colors.primary, borderRadius: '2px' }} />
        <Column style={{ paddingLeft: '16px' }}>
          <Text
            style={{
              ...typography.text,
              marginTop: '0',
              marginBottom: '0',
              fontStyle: 'italic',
            }}
          >
            &quot;{commentPreview}&quot;
          </Text>
        </Column>
      </Row>

      {/* CTA Button */}
      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={postUrl}>
          {t(M.cta)}
        </Button>
      </Section>

      {/* Footer */}
      <NotificationFooter
        reason={feedbackFooterReason(isPostAuthor, i18n)}
        unsubscribeUrl={unsubscribeUrl}
        preferencesUrl={preferencesUrl}
        i18n={i18n}
      />
    </EmailLayout>
  )
}
