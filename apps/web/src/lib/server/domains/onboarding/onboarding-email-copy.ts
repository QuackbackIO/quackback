/**
 * The words of the setup emails (ready, day-two nudge) and the team
 * invitation, in the recipient's language. The email package lays the copy
 * out; everything a reader sees is formatted here from the app's own locale
 * catalogues, so the emails speak the language the product does.
 *
 * Which steps an email names is decided by the launch plan; this module only
 * words what it is handed.
 */
import { createIntl, type IntlShape, type MessageDescriptor } from 'react-intl'
import type { OnboardingEmailContent } from '@quackback/email'
import {
  DEFAULT_LOCALE,
  loadMessages,
  normalizeLocale,
  type SupportedLocale,
} from '@/lib/shared/i18n'
import { htmlLangDir } from '@/lib/shared/document-locale'
import type { OnboardingOutcome } from '@/lib/shared/db-types'

/** The first supported language among a person's own and the request's, else English. */
export function recipientLocale(
  ...candidates: ReadonlyArray<string | null | undefined>
): SupportedLocale {
  for (const candidate of candidates) {
    const locale = candidate ? normalizeLocale(candidate) : null
    if (locale) return locale
  }
  return DEFAULT_LOCALE
}

async function intlFor(locale: SupportedLocale): Promise<IntlShape> {
  return createIntl({ locale, messages: await loadMessages(locale), onError: () => {} })
}

function langDir(locale: SupportedLocale): { lang: string; dir: 'ltr' | 'rtl' } {
  return htmlLangDir(locale)
}

/** The page a goal puts live, as the link to share. */
type ShareKind = 'feedback' | 'helpCenter' | 'status'

export function shareKindFor(goal: OnboardingOutcome | null | undefined): ShareKind | null {
  if (goal === 'product_feedback') return 'feedback'
  if (goal === 'help_center') return 'helpCenter'
  if (goal === 'status_page') return 'status'
  return null
}

/** The public link the primary goal put live, or null when it has none to share. */
export function shareLinkFor(
  goal: OnboardingOutcome | null | undefined,
  base: string
): { kind: ShareKind; url: string; text: string } | null {
  const kind = shareKindFor(goal)
  if (!kind) return null
  const root = base.replace(/\/$/, '')
  const path = kind === 'helpCenter' ? '/hc' : kind === 'status' ? '/status' : '/'
  const url = `${root}${path}`
  const text = url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return { kind, url, text }
}

/** A launch step as an email names it: its localised title and where it lands. */
export interface EmailStep {
  id: string
  variant?: string
  /** The plan's own title, used when no translation exists. */
  title: string
  url: string
}

function stepTitle(intl: IntlShape, step: EmailStep): string {
  const id = `onboarding.task.${step.id}${step.variant ? `.${step.variant}` : ''}`
  return intl.formatMessage({ id, defaultMessage: step.title })
}

const LIVE: Record<ShareKind, MessageDescriptor> = {
  feedback: {
    id: 'email.onboarding.ready.live.feedback',
    defaultMessage: 'Your board is live at {link}.',
  },
  helpCenter: {
    id: 'email.onboarding.ready.live.helpCenter',
    defaultMessage: 'Your help center is live at {link}.',
  },
  status: {
    id: 'email.onboarding.ready.live.status',
    defaultMessage: 'Your status page is live at {link}.',
  },
}

const SHARE_LABEL: Record<ShareKind, MessageDescriptor> = {
  feedback: { id: 'email.onboarding.share.feedback', defaultMessage: 'Your board link to share' },
  helpCenter: {
    id: 'email.onboarding.share.helpCenter',
    defaultMessage: 'Your help center link to share',
  },
  status: { id: 'email.onboarding.share.status', defaultMessage: 'Your status page link to share' },
}

const WAITING: Record<ShareKind | 'support', MessageDescriptor> = {
  feedback: {
    id: 'email.onboarding.nudge.waiting.feedback',
    defaultMessage: 'Nobody outside your team has posted an idea yet.',
  },
  helpCenter: {
    id: 'email.onboarding.nudge.waiting.helpCenter',
    defaultMessage: 'No customer has used your help center yet.',
  },
  status: {
    id: 'email.onboarding.nudge.waiting.status',
    defaultMessage: 'No customer has subscribed to your status page yet.',
  },
  support: {
    id: 'email.onboarding.nudge.waiting.support',
    defaultMessage: 'No customer has started a conversation yet.',
  },
}

const UNSUBSCRIBE: MessageDescriptor = {
  id: 'email.onboarding.unsubscribe',
  defaultMessage: 'Stop setup tips',
}

export interface OnboardingEmailCopy extends OnboardingEmailContent {
  subject: string
}

interface CommonInput {
  locale: SupportedLocale
  /** First name, or null when the person has not given one. */
  name: string | null
  workspaceName: string
  goal: OnboardingOutcome | null
  base: string
  /** The next step on the goal path, as the launch plan orders it. */
  nextStep: EmailStep | null
}

/** The one "workspace is ready" email. */
export async function readyEmailCopy(
  input: CommonInput & {
    homeUrl: string
    /** A running trial, when the workspace has one. */
    trial: { days: number; planName: string } | null
  }
): Promise<OnboardingEmailCopy> {
  const intl = await intlFor(input.locale)
  const workspace = input.workspaceName
  const share = shareLinkFor(input.goal, input.base)
  const paragraphs: string[] = []

  if (share) {
    paragraphs.push(intl.formatMessage(LIVE[share.kind], { link: share.text }))
  } else if (input.goal === 'customer_support') {
    paragraphs.push(
      intl.formatMessage({
        id: 'email.onboarding.ready.live.support',
        defaultMessage: 'Your inbox is ready for customer conversations.',
      })
    )
  }
  if (input.nextStep?.id === 'distribute-feedback') {
    paragraphs.push(
      intl.formatMessage({
        id: 'email.onboarding.ready.shareStep',
        defaultMessage: 'One step gets you to your first customer idea: share the link.',
      })
    )
  } else if (input.nextStep) {
    paragraphs.push(
      intl.formatMessage(
        { id: 'email.onboarding.ready.nextStep', defaultMessage: 'Your next step: {step}.' },
        { step: stepTitle(intl, input.nextStep) }
      )
    )
  }
  if (input.trial) {
    paragraphs.push(
      intl.formatMessage(
        {
          id: 'email.onboarding.ready.trial',
          defaultMessage:
            'You are on a {days}-day {plan} trial. No card needed, and {workspace} moves to Free if you do nothing.',
        },
        { days: input.trial.days, plan: input.trial.planName, workspace }
      )
    )
  }

  const heading = intl.formatMessage(
    { id: 'email.onboarding.ready.heading', defaultMessage: '{workspace} is ready' },
    { workspace }
  )
  return {
    ...langDir(input.locale),
    subject: input.name
      ? intl.formatMessage(
          { id: 'email.onboarding.ready.subject', defaultMessage: '{workspace} is ready, {name}' },
          { workspace, name: input.name }
        )
      : heading,
    preview: paragraphs[0] ?? heading,
    heading,
    paragraphs,
    share: share
      ? { label: intl.formatMessage(SHARE_LABEL[share.kind]), url: share.url, text: share.text }
      : null,
    cta: {
      label: intl.formatMessage(
        { id: 'email.onboarding.ready.cta', defaultMessage: 'Open {workspace}' },
        { workspace }
      ),
      url: input.homeUrl,
    },
    secondary: null,
    footer: {
      reason: intl.formatMessage(
        {
          id: 'email.onboarding.ready.reason',
          defaultMessage: 'You are getting this because you just set up {workspace}.',
        },
        { workspace }
      ),
      unsubscribeLabel: intl.formatMessage(UNSUBSCRIBE),
    },
  }
}

/** The day-two nudge: nobody outside the team has acted yet. */
export async function nudgeEmailCopy(
  input: CommonInput & {
    nextStep: EmailStep
  }
): Promise<OnboardingEmailCopy> {
  const intl = await intlFor(input.locale)
  const workspace = input.workspaceName
  const share = shareLinkFor(input.goal, input.base)
  const waitingKey = share?.kind ?? (input.goal === 'customer_support' ? 'support' : null)
  const paragraphs: string[] = [
    waitingKey
      ? intl.formatMessage(WAITING[waitingKey])
      : intl.formatMessage(
          {
            id: 'email.onboarding.nudge.waiting.generic',
            defaultMessage: 'No customer has used {workspace} yet.',
          },
          { workspace }
        ),
  ]
  if (share) {
    paragraphs.push(
      intl.formatMessage({
        id: 'email.onboarding.nudge.placeLink',
        defaultMessage:
          'Put the link where customers already are: your app, your docs or your next email.',
      })
    )
  }
  paragraphs.push(
    intl.formatMessage({
      id: 'email.onboarding.nudge.minute',
      defaultMessage: 'This takes about a minute.',
    })
  )

  const heading = intl.formatMessage({
    id: 'email.onboarding.nudge.heading',
    defaultMessage: 'Your next step',
  })
  return {
    ...langDir(input.locale),
    subject: intl.formatMessage(
      { id: 'email.onboarding.nudge.subject', defaultMessage: 'Your next step in {workspace}' },
      { workspace }
    ),
    preview: paragraphs[0],
    heading,
    paragraphs,
    share: share
      ? { label: intl.formatMessage(SHARE_LABEL[share.kind]), url: share.url, text: share.text }
      : null,
    cta: { label: stepTitle(intl, input.nextStep), url: input.nextStep.url },
    secondary: null,
    footer: {
      reason: intl.formatMessage(
        {
          id: 'email.onboarding.nudge.reason',
          defaultMessage: 'You are getting this because you set up {workspace} this week.',
        },
        { workspace }
      ),
      unsubscribeLabel: intl.formatMessage(UNSUBSCRIBE),
    },
  }
}

/**
 * The invitation in the inviting teammate's language: the invitee has no
 * account yet, so the team's own language is the best guess at theirs.
 */
export async function invitationCopyForRequest(
  inviterName: string | null | undefined,
  inviteeName: string | null | undefined,
  workspaceName: string
) {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  let acceptLanguage: string | null = null
  try {
    acceptLanguage = getRequestHeaders().get('accept-language')
  } catch {
    acceptLanguage = null
  }
  const { resolveLocale } = await import('@/lib/shared/i18n')
  const locale = resolveLocale(acceptLanguage)
  return invitationEmailCopy({ locale, inviterName, inviteeName, workspaceName })
}

/** A teammate invitation, in the inviting team's language. */
export async function invitationEmailCopy(input: {
  locale: SupportedLocale
  inviterName: string | null | undefined
  inviteeName: string | null | undefined
  workspaceName: string
}): Promise<{
  lang: string
  dir: 'ltr' | 'rtl'
  subject: string
  preview: string
  heading: string
  body: string
  cta: string
  fallback: string
  footer: string
}> {
  const intl = await intlFor(input.locale)
  const workspace = input.workspaceName
  // Never an email address as the inviter's name: a teammate without a name
  // reads as "A teammate".
  const named = input.inviterName?.trim()
  const inviter =
    named && !named.includes('@')
      ? named
      : intl.formatMessage({ id: 'email.invite.someone', defaultMessage: 'A teammate' })
  const invitee = input.inviteeName?.trim()
  const body = intl.formatMessage(
    { id: 'email.invite.body', defaultMessage: '{inviter} invited you to the {workspace} team.' },
    { inviter, workspace }
  )
  return {
    ...langDir(input.locale),
    subject: intl.formatMessage(
      { id: 'email.invite.subject', defaultMessage: '{inviter} invited you to {workspace}' },
      { inviter, workspace }
    ),
    preview: body,
    heading: invitee
      ? intl.formatMessage(
          { id: 'email.invite.headingNamed', defaultMessage: 'Hi {name}, join {workspace}' },
          { name: invitee, workspace }
        )
      : intl.formatMessage(
          { id: 'email.invite.heading', defaultMessage: 'Join {workspace}' },
          { workspace }
        ),
    body,
    cta: intl.formatMessage({ id: 'email.invite.cta', defaultMessage: 'Accept invitation' }),
    fallback: intl.formatMessage({
      id: 'email.invite.fallback',
      defaultMessage: 'Or paste this link into your browser:',
    }),
    footer: intl.formatMessage({
      id: 'email.invite.footer',
      defaultMessage: 'Not expecting this? You can ignore this email.',
    }),
  }
}
