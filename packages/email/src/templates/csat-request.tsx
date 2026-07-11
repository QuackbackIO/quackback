import { Column, Heading, Link, Row, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, colors } from './shared-styles'

/**
 * The 5 CSAT rating faces, in order (worst to best) — mirrors CSAT_FACES
 * (packages/db/src/types.ts) and the widget's block-affordance.tsx rendering
 * of a request_csat block. Duplicated as a plain literal rather than
 * imported: this package has no dependency on @quackback/db, and 5 emoji
 * aren't worth introducing one for.
 */
const CSAT_FACES = ['😞', '🙁', '😐', '🙂', '😄'] as const

interface CsatRequestEmailProps {
  /** The workflow block's own prompt text (plain text — the block body
   *  resolved server-side, never a raw template). */
  promptText: string
  /** One rating link per face, in the same order as CSAT_FACES (index 0 =
   *  rating 1). All 5 share one signed token; only the `rating` query param
   *  differs per link. */
  ratingUrls: readonly [string, string, string, string, string]
  workspaceName: string
  logoUrl?: string
}

export function CsatRequestEmail({
  promptText,
  ratingUrls,
  workspaceName,
  logoUrl,
}: CsatRequestEmailProps) {
  const heading = `How did we do, ${workspaceName}?`
  return (
    <EmailLayout preview={heading} logoUrl={logoUrl} logoAlt={workspaceName}>
      <Heading style={typography.h1}>{heading}</Heading>
      {promptText && <Text style={typography.text}>{promptText}</Text>}

      <Section style={{ textAlign: 'center', marginTop: '24px', marginBottom: '24px' }}>
        <Row>
          {CSAT_FACES.map((face, i) => (
            <Column key={face} align="center">
              <Link
                href={ratingUrls[i]}
                style={{
                  display: 'inline-block',
                  fontSize: '32px',
                  lineHeight: '40px',
                  textDecoration: 'none',
                }}
              >
                {face}
              </Link>
            </Column>
          ))}
        </Row>
      </Section>

      <Text style={{ ...typography.textSmall, color: colors.textMuted, textAlign: 'center' }}>
        Click a face above to rate your experience.
      </Text>

      <TransactionalFooter>
        You received this email because you had a conversation with {workspaceName}.
      </TransactionalFooter>
    </EmailLayout>
  )
}
