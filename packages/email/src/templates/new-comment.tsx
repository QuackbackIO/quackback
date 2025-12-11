import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { layout, typography, button, utils, branding, colors } from './shared-styles'

interface NewCommentEmailProps {
  postTitle: string
  postUrl: string
  commenterName: string
  commentPreview: string
  isTeamMember: boolean
  organizationName: string
  unsubscribeUrl: string
}

const LOGO_URL = 'https://quackback.io/logo.png'

export function NewCommentEmail({
  postTitle,
  postUrl,
  commenterName,
  commentPreview,
  isTeamMember,
  organizationName,
  unsubscribeUrl,
}: NewCommentEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>New comment on &quot;{postTitle}&quot;</Preview>
      <Body style={layout.main}>
        <Container style={layout.container}>
          {/* Logo */}
          <Section style={branding.logoContainer}>
            <Img src={LOGO_URL} alt="Quackback" style={branding.logo} />
          </Section>

          {/* Content */}
          <Heading style={typography.h1}>New comment on your feedback</Heading>
          <Text style={typography.text}>
            {commenterName}
            {isTeamMember && (
              <span
                style={{
                  backgroundColor: colors.primary,
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: '600',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  marginLeft: '8px',
                  verticalAlign: 'middle',
                }}
              >
                Team
              </span>
            )}{' '}
            commented on your feedback in {organizationName}.
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
            <Text style={{ ...typography.textSmall, margin: '0 0 4px', color: colors.textMuted }}>
              Feedback
            </Text>
            <Text style={{ ...typography.text, margin: 0, fontWeight: '600' }}>{postTitle}</Text>
          </Section>

          {/* Comment Preview */}
          <Section
            style={{
              borderLeft: `3px solid ${colors.primary}`,
              paddingLeft: '16px',
              marginBottom: '24px',
            }}
          >
            <Text style={{ ...typography.text, margin: 0, fontStyle: 'italic' }}>
              &quot;{commentPreview}&quot;
            </Text>
          </Section>

          {/* CTA Button */}
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button style={button.primary} href={postUrl}>
              View Comment
            </Button>
          </Section>

          {/* Footer */}
          <Text style={typography.footer}>
            You received this email because you submitted or subscribed to this feedback.
            <br />
            <Link href={unsubscribeUrl} style={{ ...utils.link, fontSize: '13px' }}>
              Unsubscribe from this post
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
