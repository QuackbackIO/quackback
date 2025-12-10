import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { layout, typography, utils, branding } from './shared-styles'

interface SigninCodeEmailProps {
  code: string
}

const LOGO_URL = 'https://quackback.io/logo.png'

export function SigninCodeEmail({ code }: SigninCodeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your sign-in code is {code}</Preview>
      <Body style={layout.main}>
        <Container style={layout.container}>
          {/* Logo */}
          <Section style={branding.logoContainer}>
            <Img src={LOGO_URL} alt="Quackback" style={branding.logo} />
          </Section>

          {/* Content */}
          <Heading style={{ ...typography.h1, textAlign: 'center' }}>Your sign-in code</Heading>
          <Text style={{ ...typography.text, textAlign: 'center' }}>
            Enter this code to continue signing in:
          </Text>

          {/* Code Box */}
          <Section style={utils.codeBox}>
            <Text style={utils.code}>{code}</Text>
          </Section>

          <Text style={{ ...typography.textSmall, textAlign: 'center' }}>
            This code expires in 10 minutes.
          </Text>

          {/* Footer */}
          <Text style={typography.footer}>
            If you didn&apos;t request this code, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
