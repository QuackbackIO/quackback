import { Fragment, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { FormattedMessage, useIntl, type IntlShape } from 'react-intl'
import { CheckIcon } from '@heroicons/react/24/solid'
import type { SettingsBrandingData } from '@/lib/server/domains/settings/settings.types'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import {
  LAUNCH_LIVE_STEP,
  buildLaunchTasks,
  launchPath,
  type LaunchPathGoal,
  type LaunchStatus,
  type LaunchTask,
} from '@/lib/shared/launch-checklist'
import { launchTaskWhy } from '@/lib/shared/launch-outcomes'
import { cn } from '@/lib/shared/utils'
import { buttonVariants } from '@/components/ui/button'
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

const PATH_HEADING: Record<LaunchPathGoal, { id: string; defaultMessage: string }> = {
  feedback: { id: 'onboarding.home.path.feedback', defaultMessage: 'Your path to a first idea' },
  private: { id: 'onboarding.home.path.private', defaultMessage: 'Your path to a first team idea' },
  support: {
    id: 'onboarding.home.path.support',
    defaultMessage: 'Your path to a first conversation',
  },
  helpCenter: {
    id: 'onboarding.home.path.helpCenter',
    defaultMessage: 'Your path to a first reader',
  },
  status: { id: 'onboarding.home.path.status', defaultMessage: 'Your path to a first subscriber' },
}

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

/** The open steps of the Later line, each a link to where it is done, joined as a sentence. */
function LaterItems({ intl, tasks }: { intl: IntlShape; tasks: LaunchTask[] }) {
  const parts = intl.formatListToParts(
    tasks.map((task, index) =>
      continueSentence(intl.formatMessage(launchTaskMessage(task)), intl.locale, index)
    ),
    { type: 'conjunction' }
  )
  let item = 0
  return (
    <>
      {parts.map((part, index) => {
        if (part.type !== 'element') return <Fragment key={index}>{part.value}</Fragment>
        const task = tasks[item++]!
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

/**
 * Home's first-run guide: the one step to take now with a live picture of the
 * page it is about, then the three-step path to a first win and a line of
 * what comes later. The count is the launch plan's, the same everywhere.
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
  // A status page grows by services: offered beside sharing it even after
  // setup seeded the first one, to anyone who may add one.
  const service =
    path.goal === 'status' && status.permissions?.settingsManage !== false
      ? buildLaunchTasks(status).find((task) => task.id === 'add-status-service' && !task.isSkipped)
      : undefined
  // The Later line is the polish; other goals' steps are on the launch plan page.
  const later = path.later
    .filter(
      (task) =>
        task.classification === 'polish' &&
        !task.isCompleted &&
        !task.isSkipped &&
        task.availability !== 'blocked'
    )
    .slice(0, 3)
  const page = livePage(path.goal, status, portalUrl)

  return (
    <div lang={intl.locale} className="space-y-4 [--ring:var(--muted-foreground)]">
      <section
        aria-labelledby="home-next-step"
        className="flex flex-wrap items-center gap-5 rounded-2xl border bg-card p-5 shadow-raise"
      >
        <div className="min-w-[min(16rem,100%)] flex-[1_1_20rem] space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            <FormattedMessage
              id="onboarding.home.planStep"
              defaultMessage="Launch plan · Step {step} of {total}"
              values={{ step: path.step, total: path.total }}
            />
          </p>
          <h2 id="home-next-step" className="text-lg font-semibold text-pretty">
            <LaunchTaskLabel task={next} />
          </h2>
          {why ? (
            <p className="text-sm text-muted-foreground">
              <FormattedMessage {...why} />
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <LaunchStepAction
              task={next}
              status={status}
              primary
              pending={pending}
              onCreateBoard={onCreateBoard}
              firstWinAction={<FirstWinShareAction status={status} primary />}
            />
            {service ? (
              <LaunchTaskLink
                task={service}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                <LaunchTaskLabel task={service} />
              </LaunchTaskLink>
            ) : null}
          </div>
        </div>
        <PortalSnapshot portalUrl={portalUrl} pageHref={page.href}>
          {page.href ? (
            <a
              href={page.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
            >
              <FormattedMessage {...page.label} /> <span aria-hidden="true">↗</span>
            </a>
          ) : null}
          {brandingNotice}
        </PortalSnapshot>
      </section>

      <section aria-labelledby="home-path" className="rounded-2xl border bg-card px-5 py-4">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 id="home-path" className="text-sm font-semibold">
            <FormattedMessage {...PATH_HEADING[path.goal]} />
          </h2>
          <Link
            to="/admin/getting-started"
            className="text-xs text-muted-foreground hover:underline"
          >
            <FormattedMessage id="onboarding.launch.name" defaultMessage="Launch plan" />
          </Link>
        </div>
        <ol>
          <PathRow done>
            <FormattedMessage {...LAUNCH_LIVE_STEP[path.goal]} />
          </PathRow>
          {path.steps.map((task) => (
            <PathRow
              key={task.id}
              done={task.isCompleted || task.isReady}
              next={task.id === next.id}
            >
              <LaunchTaskLabel task={task} />
            </PathRow>
          ))}
        </ol>
        {later.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            <FormattedMessage
              id="onboarding.home.later"
              defaultMessage="Later: {items}"
              values={{ items: <LaterItems intl={intl} tasks={later} /> }}
            />
          </p>
        )}
      </section>
    </div>
  )
}

function PathRow({
  done = false,
  next = false,
  children,
}: {
  done?: boolean
  next?: boolean
  children: ReactNode
}) {
  return (
    <li className="flex min-h-10 items-center gap-3 border-b border-border/60 text-sm last:border-b-0">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px]',
          done
            ? 'border-foreground bg-foreground text-background'
            : next
              ? 'border-foreground'
              : 'border-border'
        )}
      >
        {done ? <CheckIcon className="size-3" /> : null}
      </span>
      <span
        className={cn('min-w-0 flex-1', done && 'text-muted-foreground', next && 'font-semibold')}
      >
        {children}
      </span>
      {done ? (
        <span className="text-xs text-muted-foreground">
          <FormattedMessage id="onboarding.launch.done" defaultMessage="Done" />
        </span>
      ) : next ? (
        <span className="text-xs text-muted-foreground">
          <FormattedMessage id="onboarding.home.next" defaultMessage="Next" />
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
              <img src={logo} alt="" className="size-5 rounded object-contain" />
            ) : (
              <span className="size-5 rounded bg-primary" />
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
