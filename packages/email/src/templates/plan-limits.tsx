import { Button, Heading, Link, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { button, typography, utils } from './shared-styles'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

export const PLAN_LIMITS_MESSAGES = defineEmailMessages({
  yourWorkspace: { id: 'email.planLimits.yourWorkspace', defaultMessage: 'Your workspace' },
  subjectFeatures: {
    id: 'email.planLimits.subjectFeatures',
    defaultMessage: '{workspace}: some features pause after {deadline}',
  },
  subjectStartPlan: {
    id: 'email.planLimits.subjectStartPlan',
    defaultMessage: "Action needed: {workspace} is over the {plan} plan's limits",
  },
  subjectStart: {
    id: 'email.planLimits.subjectStart',
    defaultMessage: "Action needed: {workspace} is over its plan's limits",
  },
  subjectReminder: {
    id: 'email.planLimits.subjectReminder',
    defaultMessage: "2 days left to fix {workspace}'s plan limits",
  },
  subjectPaused: {
    id: 'email.planLimits.subjectPaused',
    defaultMessage: 'Some of {workspace} is now paused',
  },
  headingFeatures: {
    id: 'email.planLimits.headingFeatures',
    defaultMessage: 'Some features pause after {deadline}',
  },
  headingFix: { id: 'email.planLimits.headingFix', defaultMessage: 'Fix {issues} by {deadline}' },
  issues: {
    id: 'email.planLimits.issues',
    defaultMessage: '{count, plural, one {# issue} other {# issues}}',
  },
  introPausedPlan: {
    id: 'email.planLimits.introPausedPlan',
    defaultMessage:
      '{workspace} is still over the limits of the {plan} plan, so the items below are now paused.',
  },
  introPaused: {
    id: 'email.planLimits.introPaused',
    defaultMessage:
      '{workspace} is still over the limits of its plan, so the items below are now paused.',
  },
  introFeaturesPlan: {
    id: 'email.planLimits.introFeaturesPlan',
    defaultMessage:
      '{workspace} is over the limits of the {plan} plan. Upgrade to keep everything.',
  },
  introFeatures: {
    id: 'email.planLimits.introFeatures',
    defaultMessage: '{workspace} is over the limits of its plan. Upgrade to keep everything.',
  },
  introFixPlan: {
    id: 'email.planLimits.introFixPlan',
    defaultMessage:
      '{workspace} is over the limits of the {plan} plan. Fix {issues} by {deadline}, or upgrade to keep everything.',
  },
  introFix: {
    id: 'email.planLimits.introFix',
    defaultMessage:
      '{workspace} is over the limits of its plan. Fix {issues} by {deadline}, or upgrade to keep everything.',
  },
  row: { id: 'email.planLimits.row', defaultMessage: '{label}: {used} of {cap}. {effect}.' },
  boards: { id: 'email.planLimits.boards', defaultMessage: 'Boards' },
  boardsEffect: {
    id: 'email.planLimits.boardsEffect',
    defaultMessage:
      '{count, plural, one {# board becomes read-only} other {# boards become read-only}}',
  },
  teamSeats: { id: 'email.planLimits.teamSeats', defaultMessage: 'Team seats' },
  teamSeatsEffect: {
    id: 'email.planLimits.teamSeatsEffect',
    defaultMessage:
      '{count, plural, one {# teammate loses admin access until a seat frees up} other {# teammates lose admin access until a seat frees up}}',
  },
  statusComponents: {
    id: 'email.planLimits.statusComponents',
    defaultMessage: 'Status components',
  },
  statusComponentsEffect: {
    id: 'email.planLimits.statusComponentsEffect',
    defaultMessage:
      '{count, plural, one {# status component is hidden from your status page} other {# status components are hidden from your status page}}',
  },
  customRoles: { id: 'email.planLimits.customRoles', defaultMessage: 'Custom roles' },
  customRolesEffect: {
    id: 'email.planLimits.customRolesEffect',
    defaultMessage:
      '{count, plural, one {# custom role is locked} other {# custom roles are locked}}',
  },
  sendingDomains: { id: 'email.planLimits.sendingDomains', defaultMessage: 'Sending domains' },
  sendingDomainsEffect: {
    id: 'email.planLimits.sendingDomainsEffect',
    defaultMessage:
      '{count, plural, one {# sending domain is paused} other {# sending domains are paused}}',
  },
  helpCenterLanguages: {
    id: 'email.planLimits.helpCenterLanguages',
    defaultMessage: 'Help center languages',
  },
  helpCenterLanguagesEffect: {
    id: 'email.planLimits.helpCenterLanguagesEffect',
    defaultMessage:
      '{count, plural, one {# help center language is locked} other {# help center languages are locked}}',
  },
  customDomain: { id: 'email.planLimits.customDomain', defaultMessage: 'your custom domain' },
  sso: { id: 'email.planLimits.sso', defaultMessage: 'single sign-on' },
  webhooks: { id: 'email.planLimits.webhooks', defaultMessage: 'webhooks' },
  workflows: { id: 'email.planLimits.workflows', defaultMessage: 'workflows' },
  integrations: { id: 'email.planLimits.integrations', defaultMessage: 'integrations' },
  customCss: { id: 'email.planLimits.customCss', defaultMessage: 'your custom CSS' },
  aiAssistant: { id: 'email.planLimits.aiAssistant', defaultMessage: 'AI assistant' },
  aiArticleTranslation: {
    id: 'email.planLimits.aiArticleTranslation',
    defaultMessage: 'AI article translation',
  },
  featuresPause: {
    id: 'email.planLimits.featuresPause',
    defaultMessage: '{features} {count, plural, one {pauses} other {pause}} after {deadline}.',
  },
  featuresPausedPlan: {
    id: 'email.planLimits.featuresPausedPlan',
    defaultMessage: '{features} {count, plural, one {is} other {are}} paused on the {plan} plan.',
  },
  featuresPaused: {
    id: 'email.planLimits.featuresPaused',
    defaultMessage: '{features} {count, plural, one {is} other {are}} now paused.',
  },
  nothingDeleted: { id: 'email.planLimits.nothingDeleted', defaultMessage: 'Nothing is deleted.' },
  nothingDeletedBack: {
    id: 'email.planLimits.nothingDeletedBack',
    defaultMessage: 'Nothing is deleted. It comes back when you upgrade.',
  },
  reviewIssues: { id: 'email.planLimits.reviewIssues', defaultMessage: 'Review issues' },
  upgradeTo: { id: 'email.planLimits.upgradeTo', defaultMessage: 'Upgrade to {plan}' },
  comparePlans: { id: 'email.planLimits.comparePlans', defaultMessage: 'Compare plans' },
  footer: {
    id: 'email.planLimits.footer',
    defaultMessage: "You're getting this because you manage billing.",
  },
  footerNamed: {
    id: 'email.planLimits.footerNamed',
    defaultMessage: "You're getting this because you manage billing for {workspace}.",
  },
})

const M = PLAN_LIMITS_MESSAGES

/** Which of the three plan limits emails this is. */
export type PlanLimitsEmailKind = 'start' | 'reminder' | 'enforced'

/** Each cap an email can name: its label and what happens to the excess. */
const ISSUES = {
  maxBoards: { label: M.boards, effect: M.boardsEffect },
  maxTeamSeats: { label: M.teamSeats, effect: M.teamSeatsEffect },
  maxStatusComponents: { label: M.statusComponents, effect: M.statusComponentsEffect },
  maxCustomRoles: { label: M.customRoles, effect: M.customRolesEffect },
  maxSendingDomains: { label: M.sendingDomains, effect: M.sendingDomainsEffect },
  maxHelpCenterLocales: { label: M.helpCenterLanguages, effect: M.helpCenterLanguagesEffect },
} as const

/** Each paid feature an email can name as pausing, as it reads inside a sentence. */
const FEATURES = {
  customDomain: M.customDomain,
  sso: M.sso,
  webhooks: M.webhooks,
  workflows: M.workflows,
  integrations: M.integrations,
  customCss: M.customCss,
  aiAssistant: M.aiAssistant,
  aiArticleTranslation: M.aiArticleTranslation,
} as const

export type PlanLimitsEmailIssueKey = keyof typeof ISSUES
export type PlanLimitsEmailFeatureKey = keyof typeof FEATURES

/** One cap the workspace is over: what it uses and its cap. */
export interface PlanLimitsEmailRow {
  key: PlanLimitsEmailIssueKey
  used: number
  cap: number
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
  /** The paid features that pause. */
  pausingFeatures: readonly PlanLimitsEmailFeatureKey[]
  limitsUrl: string | null
  planUrl: string | null
  logoUrl?: string
  /** The reader's language; English without one. */
  i18n?: EmailLocale
}

/** The subject of a plan limits email. */
export function planLimitsSubject(
  kind: PlanLimitsEmailKind,
  workspaceName: string | undefined,
  planName: string | null | undefined,
  /** Set when only features pause and no cap is over: the date, as in a sentence. */
  featuresOnlyDeadline?: string,
  i18n: EmailLocale = ENGLISH_EMAIL
): string {
  const { t } = i18n
  const workspace = workspaceName ?? t(M.yourWorkspace)
  if (featuresOnlyDeadline && kind !== 'enforced') {
    return t(M.subjectFeatures, { workspace, deadline: featuresOnlyDeadline })
  }
  if (kind === 'start') {
    return planName
      ? t(M.subjectStartPlan, { workspace, plan: planName })
      : t(M.subjectStart, { workspace })
  }
  if (kind === 'reminder') return t(M.subjectReminder, { workspace })
  return t(M.subjectPaused, { workspace })
}

function heading(props: PlanLimitsEmailProps, i18n: EmailLocale): string {
  if (props.kind === 'enforced')
    return planLimitsSubject(props.kind, props.workspaceName, null, undefined, i18n)
  if (props.rows.length === 0) return i18n.t(M.headingFeatures, { deadline: props.deadlineHeading })
  return i18n.t(M.headingFix, {
    issues: i18n.t(M.issues, { count: props.rows.length }),
    deadline: props.deadlineHeading,
  })
}

function intro(props: PlanLimitsEmailProps, i18n: EmailLocale): string {
  const { t } = i18n
  const workspace = props.workspaceName ?? t(M.yourWorkspace)
  const plan = props.planName
  if (props.kind === 'enforced') {
    return plan ? t(M.introPausedPlan, { workspace, plan }) : t(M.introPaused, { workspace })
  }
  if (props.rows.length === 0) {
    return plan ? t(M.introFeaturesPlan, { workspace, plan }) : t(M.introFeatures, { workspace })
  }
  const values = {
    workspace,
    issues: t(M.issues, { count: props.rows.length }),
    deadline: props.deadline,
  }
  return plan ? t(M.introFixPlan, { ...values, plan }) : t(M.introFix, values)
}

/** The first letter as a sentence opens, in scripts that have capitals. */
function sentenceCase(text: string, lang: string): string {
  return text.charAt(0).toLocaleUpperCase(lang) + text.slice(1)
}

/**
 * The pausing features as a list in the reader's language ("webhooks,
 * workflows and your custom domain"). English joins without a serial comma.
 */
export function featureList(
  keys: readonly PlanLimitsEmailFeatureKey[],
  i18n: EmailLocale = ENGLISH_EMAIL
): string {
  const lang = i18n.lang === 'en' ? 'en-GB' : i18n.lang
  return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(
    keys.map((key) => i18n.t(FEATURES[key]))
  )
}

function featureLine(props: PlanLimitsEmailProps, i18n: EmailLocale): string {
  const values = {
    features: featureList(props.pausingFeatures, i18n),
    count: props.pausingFeatures.length,
  }
  const line =
    props.kind !== 'enforced'
      ? i18n.t(M.featuresPause, { ...values, deadline: props.deadline })
      : props.planName
        ? i18n.t(M.featuresPausedPlan, { ...values, plan: props.planName })
        : i18n.t(M.featuresPaused, values)
  return sentenceCase(line, i18n.lang)
}

/**
 * Sent to the people who manage billing when a workspace is over its plan's
 * limits: when it is first seen over, two days before the deadline, and once
 * the deadline has passed and the items are paused.
 */
export function PlanLimitsEmail(props: PlanLimitsEmailProps) {
  const { kind, rows, pausingFeatures, limitsUrl, planUrl, workspaceName, logoUrl } = props
  const i18n = props.i18n ?? ENGLISH_EMAIL
  const { t } = i18n
  const title = heading(props, i18n)
  return (
    <EmailLayout preview={title} logoUrl={logoUrl} i18n={i18n}>
      <Heading style={typography.h1}>{title}</Heading>
      <Text style={typography.text}>{intro(props, i18n)}</Text>
      <Section>
        {rows.map((row) => (
          <Text key={row.key} style={typography.text}>
            {rowLine(row, i18n)}
          </Text>
        ))}
        {pausingFeatures.length > 0 ? (
          <Text style={typography.text}>{featureLine(props, i18n)}</Text>
        ) : null}
      </Section>
      <Text style={typography.text}>
        {kind === 'enforced' ? t(M.nothingDeletedBack) : t(M.nothingDeleted)}
      </Text>
      {limitsUrl ? (
        <Section style={{ margin: '24px 0' }}>
          <Button style={button.primary} href={limitsUrl}>
            {t(M.reviewIssues)}
          </Button>
        </Section>
      ) : null}
      {planUrl ? (
        <Text style={typography.text}>
          <Link href={planUrl} style={utils.link}>
            {props.fromPlanName ? t(M.upgradeTo, { plan: props.fromPlanName }) : t(M.comparePlans)}
          </Link>
        </Text>
      ) : null}
      <TransactionalFooter>
        {workspaceName ? t(M.footerNamed, { workspace: workspaceName }) : t(M.footer)}
      </TransactionalFooter>
    </EmailLayout>
  )
}

/** "**Boards**: 5 of 1. 4 boards become read-only.", the cap's name in bold. */
function rowLine(row: PlanLimitsEmailRow, i18n: EmailLocale) {
  const issue = ISSUES[row.key]
  const label = i18n.t(issue.label)
  const line = i18n.t(M.row, {
    label,
    used: row.used,
    cap: row.cap,
    effect: i18n.t(issue.effect, { count: Math.max(row.used - row.cap, 1) }),
  })
  const at = line.indexOf(label)
  if (at === -1) return line
  return (
    <>
      {line.slice(0, at)}
      <strong>{label}</strong>
      {line.slice(at + label.length)}
    </>
  )
}
