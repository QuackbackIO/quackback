import { Button, Heading, Link, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { button, typography, utils } from './shared-styles'

/** Which of the three plan limits emails this is. */
export type PlanLimitsEmailKind = 'start' | 'reminder' | 'enforced'

/** One cap the workspace is over: what it uses and what happens to the excess. */
export interface PlanLimitsEmailRow {
  label: string
  used: number
  cap: number
  /** What happens to the excess, e.g. "4 become read-only". */
  effect: string
}

export interface PlanLimitsEmailProps {
  kind: PlanLimitsEmailKind
  workspaceName?: string
  /** The plan the workspace is on now; absent when unknown. */
  planName?: string | null
  /** The plan it had before, named on the secondary link when known. */
  fromPlanName?: string | null
  /** The date the grace ends, already formatted. */
  graceEnds: string
  rows: readonly PlanLimitsEmailRow[]
  /** Names of the paid features that pause. */
  pausingFeatures: readonly string[]
  limitsUrl: string | null
  planUrl: string | null
  logoUrl?: string
}

function things(count: number): string {
  return `${count} ${count === 1 ? 'thing' : 'things'}`
}

/** The subject and heading of a plan limits email. */
export function planLimitsTitle(
  kind: PlanLimitsEmailKind,
  count: number,
  graceEnds: string
): string {
  const fix = `Fix ${things(Math.max(count, 1))} by ${graceEnds}`
  if (kind === 'start') return fix
  if (kind === 'reminder') return `2 days left. ${fix}`
  return 'Plan limits now apply'
}

function intro(props: PlanLimitsEmailProps): string {
  const name = props.workspaceName ?? 'Your workspace'
  const plan = props.planName ? `the ${props.planName} plan` : 'its plan'
  if (props.kind === 'enforced') {
    return `The grace period for ${name} ended on ${props.graceEnds}. It still uses more than ${plan} includes, so the extras are now paused.`
  }
  const days = props.kind === 'reminder' ? '2 days left. ' : ''
  return `${days}${name} uses more than ${plan} includes. Everything keeps working until ${props.graceEnds}.`
}

/**
 * Sent to the people who manage billing when a workspace is over its plan's
 * limits: when the grace starts, two days before it ends, and once it has
 * ended and the extras are paused.
 */
export function PlanLimitsEmail(props: PlanLimitsEmailProps) {
  const { kind, rows, pausingFeatures, limitsUrl, planUrl, workspaceName, logoUrl } = props
  const title = planLimitsTitle(kind, rows.length, props.graceEnds)
  return (
    <EmailLayout preview={title} logoUrl={logoUrl}>
      <Heading style={typography.h1}>{title}</Heading>
      <Text style={typography.text}>{intro(props)}</Text>
      <Section>
        {rows.map((row) => (
          <Text key={row.label} style={typography.text}>
            <strong>{row.label}</strong>: {row.used} of {row.cap}. {row.effect}.
          </Text>
        ))}
        {pausingFeatures.length > 0 ? (
          <Text style={typography.text}>
            <strong>{pausingFeatures.join(', ')}</strong>{' '}
            {kind === 'enforced' ? 'are paused' : 'pause'}.
          </Text>
        ) : null}
      </Section>
      <Text style={typography.text}>
        {kind === 'enforced'
          ? 'Nothing is deleted. Fix each item, or move to a plan that includes them, and it is restored.'
          : 'Nothing is deleted. Fix each item, or choose a plan that includes them, and everything stays as it is.'}
      </Text>
      {limitsUrl ? (
        <Section style={{ margin: '24px 0' }}>
          <Button style={button.primary} href={limitsUrl}>
            {kind === 'enforced' ? 'Restore what is paused' : 'Review what to fix'}
          </Button>
        </Section>
      ) : null}
      {planUrl ? (
        <Text style={typography.text}>
          <Link href={planUrl} style={utils.link}>
            {props.fromPlanName ? `Keep ${props.fromPlanName}` : 'See plans'}
          </Link>
        </Text>
      ) : null}
      <TransactionalFooter>
        You&apos;re receiving this because you manage billing
        {workspaceName ? ` for ${workspaceName}` : ''}.
      </TransactionalFooter>
    </EmailLayout>
  )
}
