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
  /** The plan it had before, named on the upgrade link when known. */
  fromPlanName?: string | null
  /** The last full day to fix as it reads in a sentence, e.g. "Nov 23". */
  deadline: string
  /** The deadline as it reads in a heading, e.g. "Mon, Nov 23". */
  deadlineHeading: string
  rows: readonly PlanLimitsEmailRow[]
  /** Names of the paid features that pause. */
  pausingFeatures: readonly string[]
  limitsUrl: string | null
  planUrl: string | null
  logoUrl?: string
}

function issues(count: number): string {
  const n = Math.max(count, 1)
  return `${n} ${n === 1 ? 'issue' : 'issues'}`
}

/** The subject of a plan limits email. */
export function planLimitsSubject(
  kind: PlanLimitsEmailKind,
  workspaceName: string | undefined,
  planName: string | null | undefined,
  /** Set when only features pause and no cap is over: the date, as in a sentence. */
  featuresOnlyDeadline?: string
): string {
  const name = workspaceName ?? 'Your workspace'
  if (featuresOnlyDeadline && kind === 'start') {
    return `Some features pause after ${featuresOnlyDeadline}`
  }
  if (kind === 'start') {
    return `Action needed: ${name} is over the ${planName ?? 'current'} plan's limits`
  }
  if (kind === 'reminder') return `2 days left to fix ${name}'s plan limits`
  return `Some of ${name} is now paused`
}

function heading(props: PlanLimitsEmailProps): string {
  if (props.kind === 'enforced') return planLimitsSubject(props.kind, props.workspaceName, null)
  if (props.rows.length === 0) return `Some features pause after ${props.deadlineHeading}`
  return `Fix ${issues(props.rows.length)} by ${props.deadlineHeading}`
}

function intro(props: PlanLimitsEmailProps): string {
  const name = props.workspaceName ?? 'Your workspace'
  const plan = props.planName ? `the ${props.planName} plan` : 'its plan'
  if (props.kind === 'enforced') {
    return `${name} is still over the limits of ${plan}, so the items below are now paused.`
  }
  if (props.rows.length === 0) {
    return `${name} is over the limits of ${plan}. Upgrade to keep everything.`
  }
  return `${name} is over the limits of ${plan}. Fix ${issues(props.rows.length)} by ${props.deadline}, or upgrade to keep everything.`
}

/**
 * Feature names as a sentence's subject, joined without a serial comma: "Webhooks, workflows and your custom
 * domain". Names after the first lose their leading capital unless they open
 * with an acronym (AI, MCP), and "Custom ..." names read as the workspace's own.
 */
export function featureList(names: readonly string[]): string {
  const items = names.map((name, index) => {
    const own = /^Custom /.test(name)
      ? `your ${name.charAt(0).toLowerCase()}${name.slice(1)}`
      : name
    if (index === 0) return own.charAt(0).toUpperCase() + own.slice(1)
    const first = own.split(' ')[0] ?? ''
    return /^[A-Z]{2,}$/.test(first) ? own : own.charAt(0).toLowerCase() + own.slice(1)
  })
  return new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }).format(items)
}

function featureLine(props: PlanLimitsEmailProps): string {
  const list = featureList(props.pausingFeatures)
  const many = props.pausingFeatures.length > 1
  if (props.kind === 'enforced') {
    return `${list} ${many ? 'are' : 'is'} paused on the ${props.planName ?? 'current'} plan.`
  }
  return `${list} ${many ? 'pause' : 'pauses'} after ${props.deadline}.`
}

/**
 * Sent to the people who manage billing when a workspace is over its plan's
 * limits: when it is first seen over, two days before the deadline, and once
 * the deadline has passed and the items are paused.
 */
export function PlanLimitsEmail(props: PlanLimitsEmailProps) {
  const { kind, rows, pausingFeatures, limitsUrl, planUrl, workspaceName, logoUrl } = props
  const title = heading(props)
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
          <Text style={typography.text}>{featureLine(props)}</Text>
        ) : null}
      </Section>
      <Text style={typography.text}>
        {kind === 'enforced'
          ? 'Nothing is deleted. It comes back when you upgrade.'
          : 'Nothing is deleted.'}
      </Text>
      {limitsUrl ? (
        <Section style={{ margin: '24px 0' }}>
          <Button style={button.primary} href={limitsUrl}>
            Review issues
          </Button>
        </Section>
      ) : null}
      {planUrl ? (
        <Text style={typography.text}>
          <Link href={planUrl} style={utils.link}>
            {props.fromPlanName ? `Upgrade to ${props.fromPlanName}` : 'Compare plans'}
          </Link>
        </Text>
      ) : null}
      <TransactionalFooter>
        You&apos;re getting this because you manage billing
        {workspaceName ? ` for ${workspaceName}` : ''}.
      </TransactionalFooter>
    </EmailLayout>
  )
}
