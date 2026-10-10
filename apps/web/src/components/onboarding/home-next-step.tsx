import { Fragment, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { FormattedMessage, useIntl, type IntlShape } from 'react-intl'
import { CheckIcon } from '@heroicons/react/24/solid'
import type { SettingsBrandingData } from '@/lib/server/domains/settings/settings.types'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import {
  LAUNCH_LIVE_STEP,
  launchPath,
  openLaterSteps,
  type LaunchPathGoal,
  type LaunchStatus,
  type LaunchTask,
} from '@/lib/shared/launch-checklist'
import { launchTaskWhy } from '@/lib/shared/launch-outcomes'
import { cn } from '@/lib/shared/utils'
import { LaunchStepAction } from './launch-step-action'
import { LaunchTaskLabel, launchTaskMessage } from './launch-task-label'
import { LaunchTaskLink } from './launch-task-link'
import { FirstWinShareAction } from './goal-actions'

/** Languages whose step titles start lowercase inside a sentence; German nouns, for one, do not. */
const SENTENCE_CASE = new Set(['en', 'es', 'fr', 'nl', 'pl', 'pt', 'ru'])

/** Items after the first continue the sentence, so they start lowercase where that is right. */
function continueSentence(text: string, locale: string, index: number): string {
  if (index === 0 || !SENTENCE_CASE.has(locale.split('-')[0]!.toLowerCase())) return text
  return text.charAt(0).toLocaleLowerCase(locale) + text.slice(1)
}

/** How many later steps the line names before it counts the rest. */
const LATER_NAMED = 3

/** The current step's heading: where focus goes when Home changes under it. */
export const HOME_PLAN_HEADING_ID = 'home-plan-step'

/** Where the live page is and what its link says, per goal. */
function livePage(goal: LaunchPathGoal, status: LaunchStatus, portalUrl?: string) {
  const at = (path: string) => (portalUrl ? new URL(path, portalUrl).toString() : undefined)
  switch (goal) {
    case 'feedback':
    case 'private':
      return {
        href: at(status.publicBoardPath ?? '/'),
        label: { id: 'onboarding.home.viewBoard', defaultMessage: 'View board' },
      }
    case 'helpCenter':
      return {
        href: at('/hc'),
        label: { id: 'onboarding.home.viewHelpCenter', defaultMessage: 'View help center' },
      }
    case 'status':
      return {
        href: at('/status'),
        label: { id: 'onboarding.home.viewStatusPage', defaultMessage: 'View status page' },
      }
    default:
      return {
        href: portalUrl,
        label: { id: 'onboarding.home.viewPortal', defaultMessage: 'View portal' },
      }
  }
}

/**
 * The open later steps, each a link to where it is done, joined as a
 * sentence. Past the first few, the rest are counted.
 */
function LaterItems({ intl, tasks }: { intl: IntlShape; tasks: LaunchTask[] }) {
  const named = tasks.length > LATER_NAMED + 1 ? tasks.slice(0, LATER_NAMED) : tasks
  const rest = tasks.length - named.length
  const texts = named.map((task, index) =>
    continueSentence(intl.formatMessage(launchTaskMessage(task)), intl.locale, index)
  )
  if (rest > 0) {
    texts.push(
      intl.formatMessage(
        { id: 'onboarding.home.laterMore', defaultMessage: '{count} more' },
        { count: rest }
      )
    )
  }
  const parts = intl.formatListToParts(texts, { type: 'conjunction' })
  let item = 0
  return (
    <>
      {parts.map((part, index) => {
        if (part.type !== 'element') return <Fragment key={index}>{part.value}</Fragment>
        const task = named[item++]
        if (!task) return <Fragment key={index}>{part.value}</Fragment>
        return (
          <LaunchTaskLink
            key={index}
            task={task}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {part.value}
          </LaunchTaskLink>
        )
      })}
    </>
  )
}

/** What to say when the plan moves to its next step: the one just done, then the next. */
export function stepAnnouncement(
  intl: IntlShape,
  previous: LaunchTask | null,
  next: LaunchTask,
  steps: readonly LaunchTask[]
): string {
  const nextLabel = intl.formatMessage(launchTaskMessage(next))
  const before = previous ? steps.find((task) => task.id === previous.id) : undefined
  if (before && before.id !== next.id && (before.isCompleted || before.isReady)) {
    return intl.formatMessage(
      { id: 'onboarding.home.announce.stepDone', defaultMessage: '{done} done. Next: {next}' },
      { done: intl.formatMessage(launchTaskMessage(before)), next: nextLabel }
    )
  }
  return intl.formatMessage(
    { id: 'onboarding.home.announce.next', defaultMessage: 'Next: {next}' },
    { next: nextLabel }
  )
}

/**
 * Home's launch plan, in one card: the three-step path to a first win with
 * the current step open (why it matters, its one action and a live picture
 * of the page it is about), then the open steps that come later. The count
 * is the launch plan's, the same everywhere.
 */
export function HomeNextStep({
  status,
  portalUrl,
  brandingNotice,
  pending,
  onCreateBoard,
}: {
  status: LaunchStatus
  portalUrl?: string
  /** Logo and color found on the workspace's website, shown under the snapshot. */
  brandingNotice?: ReactNode
  pending: boolean
  onCreateBoard: () => void
}) {
  const intl = useIntl()
  const path = launchPath(status)
  const next = path.next
  if (path.complete || !next) return null
  const why = launchTaskWhy(next)
  const later = openLaterSteps(path)
  const page = livePage(path.goal, status, portalUrl)

  return (
    <section
      lang={intl.locale}
      aria-labelledby={HOME_PLAN_HEADING_ID}
      data-home-card="plan"
      className="rounded-panel border border-border bg-card p-5 [--ring:var(--muted-foreground)]"
    >
      <p className="text-xs font-medium text-muted-foreground">
        <FormattedMessage
          id="onboarding.home.planStep"
          defaultMessage="Launch plan · Step {step} of {total}"
          values={{ step: path.step, total: path.total }}
        />
      </p>
      <ol className="mt-2">
        <PathRow state="done">
          <FormattedMessage {...LAUNCH_LIVE_STEP[path.goal]} />
        </PathRow>
        {path.steps.map((task) =>
          task.id === next.id ? (
            <li
              key={task.id}
              data-state="current"
              className="flex gap-3 border-b border-border/60 py-4 last:border-b-0"
            >
              <StepMark state="current" className="mt-1" />
              <div className="flex min-w-0 flex-1 flex-wrap gap-x-5 gap-y-4">
                <div className="min-w-[min(14rem,100%)] flex-[1_1_16rem] space-y-2">
                  <h2
                    id={HOME_PLAN_HEADING_ID}
                    tabIndex={-1}
                    data-slot="path-step"
                    className="text-lg font-semibold text-pretty outline-none"
                  >
                    <LaunchTaskLabel task={task} />
                  </h2>
                  {why ? (
                    <p className="text-sm text-muted-foreground">
                      <FormattedMessage {...why} />
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <LaunchStepAction
                      task={task}
                      status={status}
                      primary
                      pending={pending}
                      onCreateBoard={onCreateBoard}
                      firstWinAction={<FirstWinShareAction status={status} primary />}
                    />
                  </div>
                </div>
                <PortalSnapshot portalUrl={portalUrl} pageHref={page.href}>
                  {page.href ? (
                    <a
                      href={page.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-fit text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                    >
                      <FormattedMessage {...page.label} /> <span aria-hidden="true">↗</span>
                    </a>
                  ) : null}
                  {brandingNotice}
                </PortalSnapshot>
              </div>
            </li>
          ) : (
            <PathRow key={task.id} state={task.isCompleted || task.isReady ? 'done' : 'waiting'}>
              <LaunchTaskLabel task={task} />
            </PathRow>
          )
        )}
      </ol>
      {later.length > 0 && (
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <p className="min-w-0">
            <FormattedMessage
              id="onboarding.home.later"
              defaultMessage="Later: {items}"
              values={{ items: <LaterItems intl={intl} tasks={later} /> }}
            />
          </p>
          <Link
            to="/admin/getting-started"
            className="shrink-0 font-medium hover:text-foreground hover:underline"
          >
            <FormattedMessage id="onboarding.home.allSteps" defaultMessage="All steps" />
          </Link>
        </div>
      )}
    </section>
  )
}

type StepState = 'done' | 'current' | 'waiting'

function StepMark({ state, className }: { state: StepState; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px]',
        state === 'done'
          ? 'border-foreground bg-foreground text-background'
          : state === 'current'
            ? 'border-foreground'
            : 'border-muted-foreground/40',
        className
      )}
    >
      {state === 'done' ? <CheckIcon className="size-3" /> : null}
    </span>
  )
}

/** A step on the path that is not the current one: done, or waiting its turn. */
function PathRow({
  state,
  children,
}: {
  state: Exclude<StepState, 'current'>
  children: ReactNode
}) {
  return (
    <li
      data-state={state}
      className="flex min-h-10 items-center gap-3 border-b border-border/60 text-sm last:border-b-0"
    >
      <StepMark state={state} />
      <span
        data-slot="path-step"
        className={cn('min-w-0 flex-1', state === 'done' && 'text-muted-foreground')}
      >
        {children}
      </span>
      {state === 'done' ? (
        <span className="text-xs text-muted-foreground">
          <FormattedMessage id="onboarding.launch.done" defaultMessage="Done" />
        </span>
      ) : null}
    </li>
  )
}

/** A small, live picture of the portal: its name and brand, linking to the live page. */
function PortalSnapshot({
  portalUrl,
  pageHref,
  children,
}: {
  portalUrl?: string
  pageHref?: string
  children?: ReactNode
}) {
  const settings = useWorkspaceSettings()
  const branding = (settings as { brandingData?: SettingsBrandingData } | undefined)?.brandingData
  const name = branding?.name ?? settings?.name ?? ''
  const logo = branding?.logoUrl ?? null
  const host = portalUrl ? new URL(portalUrl).host : null
  return (
    <div className="flex w-full shrink-0 flex-col gap-2 sm:w-56">
      <a
        href={pageHref ?? portalUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={host ?? name}
        tabIndex={-1}
        className="block overflow-hidden rounded-xl border bg-background hover:border-foreground/30"
      >
        <span className="flex gap-1 border-b px-2.5 py-2" aria-hidden="true">
          <span className="size-1.5 rounded-full bg-muted-foreground/30" />
          <span className="size-1.5 rounded-full bg-muted-foreground/30" />
          <span className="size-1.5 rounded-full bg-muted-foreground/30" />
        </span>
        <span className="flex flex-col gap-2 p-3" aria-hidden="true">
          <span className="flex items-center gap-2 text-xs font-semibold">
            {logo ? (
              <img src={logo} alt="" className="size-5 shrink-0 rounded object-contain" />
            ) : (
              <span className="size-5 shrink-0 rounded bg-primary" />
            )}
            <span className="truncate">{name}</span>
          </span>
          <span className="h-2 w-4/5 rounded-full bg-muted" />
          <span className="h-2 w-3/5 rounded-full bg-muted" />
        </span>
        {host && (
          <span className="block truncate border-t px-3 py-1.5 text-[11px] text-muted-foreground">
            {host}
          </span>
        )}
      </a>
      {children}
    </div>
  )
}
