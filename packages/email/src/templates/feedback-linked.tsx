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

interface FeedbackLinkedEmailProps {
  recipientName?: string
  postTitle: string
  postUrl: string
  workspaceName: string
  unsubscribeUrl: string
  attributedByName?: string
}

const LOGO_URL = 'https://quackback.io/logo.png'

export function FeedbackLinkedEmail({
  recipientName,
  postTitle,
  postUrl,
  workspaceName,
  unsubscribeUrl,
  attributedByName,
}: FeedbackLinkedEmailProps) {
  const greeting = recipientName ? `Thanks ${recipientName}!` : 'Thanks!'
  const attribution = attributedByName
    ? ` ${attributedByName} from the ${workspaceName} team has linked your feedback to a post.`
    : ` Your feedback has been linked to a post on ${workspaceName}.`

  return (
    <Html>
      <Head />
      <Preview>Your feedback has been linked to "{postTitle}"</Preview>
      <Body style={layout.main}>
        <Container style={layout.container}>
          {/* Logo */}
          <Section style={branding.logoContainer}>
            <Img src={LOGO_URL} alt="Quackback" style={branding.logo} />
          </Section>

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
            <Text style={{ ...typography.text, margin: 0, fontWeight: '600' }}>{postTitle}</Text>
          </Section>

          {/* CTA Button */}
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button style={button.primary} href={postUrl}>
              View Feedback
            </Button>
          </Section>

          {/* Footer */}
          <Text style={typography.footer}>
            You received this email because your feedback was attributed to this post.
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
