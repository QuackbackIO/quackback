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

interface ChangelogPublishedEmailProps {
  changelogTitle: string
  changelogUrl: string
  contentPreview: string
  organizationName: string
  unsubscribeUrl: string
}

const LOGO_URL = 'https://quackback.io/logo.png'

export function ChangelogPublishedEmail({
  changelogTitle,
  changelogUrl,
  contentPreview,
  organizationName,
  unsubscribeUrl,
}: ChangelogPublishedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        New update from {organizationName}: {changelogTitle}
      </Preview>
      <Body style={layout.main}>
        <Container style={layout.container}>
          {/* Logo */}
          <Section style={branding.logoContainer}>
            <Img src={LOGO_URL} alt="Quackback" style={branding.logo} />
          </Section>

          {/* Content */}
          <Heading style={typography.h1}>New update published</Heading>
          <Text style={typography.text}>
            {organizationName} just published an update related to your feedback.
          </Text>

          {/* Changelog Title */}
          <Section
            style={{
              backgroundColor: colors.surfaceMuted,
              borderRadius: '8px',
              padding: '16px 20px',
              marginBottom: '24px',
            }}
          >
            <Text style={{ ...typography.text, margin: 0, fontWeight: '600' }}>
              {changelogTitle}
            </Text>
            {contentPreview && (
              <Text style={{ ...typography.textSmall, margin: '8px 0 0' }}>{contentPreview}</Text>
            )}
          </Section>

          {/* CTA Button */}
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button style={button.primary} href={changelogUrl}>
              View Update
            </Button>
          </Section>

          {/* Footer */}
          <Text style={typography.footer}>
            You received this email because you submitted or subscribed to feedback related to this
            update.
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
