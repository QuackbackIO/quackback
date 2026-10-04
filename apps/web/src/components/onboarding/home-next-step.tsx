import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { CheckIcon } from '@heroicons/react/24/solid'
import type { SettingsBrandingData } from '@/lib/server/domains/settings/settings.types'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { launchGoalPath, type LaunchStatus, type LaunchTask } from '@/lib/shared/launch-checklist'
import { cn } from '@/lib/shared/utils'
import { LaunchStepAction } from './launch-step-action'
import { LaunchTaskLabel, LaunchTaskOutcome, launchTaskMessage } from './launch-task-label'
import { TryMessengerButton } from './try-messenger-button'
import type { TryMessengerStart } from './try-messenger-sheet'

const PATH_LENGTH = 3

/** Languages whose step titles start lowercase inside a sentence; German nouns, for one, do not. */
const SENTENCE_CASE = new Set(['en', 'es', 'fr', 'nl', 'pl', 'pt', 'ru'])

/** Items after the first continue the sentence, so they start lowercase where that is right. */
function continueSentence(text: string, locale: string, index: number): string {
  if (index === 0 || !SENTENCE_CASE.has(locale.split('-')[0]!.toLowerCase())) return text
  return text.charAt(0).toLocaleLowerCase(locale) + text.slice(1)
}

/** The test on the Try Messenger sheet that shows a step working, if it has one. */
function stepTest(task: LaunchTask): TryMessengerStart | null {
  if (task.id === 'distribute-feedback') return 'idea'
  if (task.id === 'connect-messenger') return 'message'
  if (task.classification === 'first_win') {
    if (task.variant === 'feedback') return 'idea'
    if (task.variant === 'support') return 'message'
  }
  return null
}

function TestLabel({ start }: { start: TryMessengerStart }) {
  return start === 'idea' ? (
    <FormattedMessage id="onboarding.test.postTestIdea" defaultMessage="Post a test idea" />
  ) : (
    <FormattedMessage id="onboarding.test.sendTestMessage" defaultMessage="Send a test message" />
  )
}

const PATH_HEADING: Record<string, { id: string; defaultMessage: string }> = {
  feedback: { id: 'onboarding.home.path.feedback', defaultMessage: 'Your path to a first idea' },
  support: {
    id: 'onboarding.home.path.support',
    defaultMessage: 'Your path to a first conversation',
  },
  helpCenter: {
    id: 'onboarding.home.path.helpCenter',
    defaultMessage: 'Your path to a first article',
  },
  status: { id: 'onboarding.home.path.status', defaultMessage: 'Your path to a first service' },
  other: { id: 'onboarding.home.path.other', defaultMessage: 'Your path to a first result' },
}

/**
 * Home's first-run guide: one Next step card with a live snapshot of the
 * portal, then the short path to a first result and a line of what comes later.
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
  const path = launchGoalPath(status)
  const next = path.next
  const win = path.steps.find((task) => task.classification === 'first_win')
  const goal = win?.variant && win.variant in PATH_HEADING ? win.variant : 'other'
  const nextIndex = next ? path.steps.findIndex((task) => task.id === next.id) : -1
  const test = next ? stepTest(next) : null
  const firstWin = next?.classification === 'first_win'
  const later = path.later.map((task, index) =>
    continueSentence(intl.formatMessage(launchTaskMessage(task)), intl.locale, index)
  )

  return (
    <div className="space-y-4 [--ring:var(--muted-foreground)]">
      {next && (
        <section
          aria-labelledby="home-next-step"
          className="flex flex-wrap items-center gap-5 rounded-2xl border bg-card p-5 shadow-raise"
        >
          <div className="min-w-[16rem] flex-[1_1_20rem] space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {nextIndex >= 0 ? (
                <FormattedMessage
                  id="onboarding.home.nextStepOf"
                  defaultMessage="Next step · {step} of {total}"
                  values={{ step: nextIndex + 2, total: PATH_LENGTH }}
                />
              ) : (
                <FormattedMessage id="onboarding.home.nextStep" defaultMessage="Next step" />
              )}
            </p>
            <h2 id="home-next-step" className="text-lg font-semibold text-pretty">
              <LaunchTaskLabel task={next} />
            </h2>
            <p className="text-sm text-muted-foreground">
              <LaunchTaskOutcome task={next} />
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <LaunchStepAction
                task={next}
                status={status}
                primary
                pending={pending}
                onCreateBoard={onCreateBoard}
                firstWinAction={
                  firstWin && test ? (
                    <TryMessengerButton start={test} size="sm" className="h-8">
                      <TestLabel start={test} />
                    </TryMessengerButton>
                  ) : null
                }
              />
              {!firstWin && test ? (
                <TryMessengerButton start={test} variant="outline" size="sm" className="h-8">
                  <TestLabel start={test} />
                </TryMessengerButton>
              ) : null}
            </div>
          </div>
          <PortalSnapshot portalUrl={portalUrl}>{brandingNotice}</PortalSnapshot>
        </section>
      )}

      <section aria-labelledby="home-path" className="rounded-2xl border bg-card px-5 py-4">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 id="home-path" className="text-sm font-semibold">
            <FormattedMessage {...PATH_HEADING[goal]} />
          </h2>
          <Link
            to="/admin/getting-started"
            className="text-xs text-muted-foreground hover:underline"
          >
            <FormattedMessage id="onboarding.launch.all" defaultMessage="See all" />
          </Link>
        </div>
        <ol>
          <PathRow done>
            <FormattedMessage id="onboarding.launch.live" defaultMessage="Portal is live" />
          </PathRow>
          {path.steps.map((task) => (
            <PathRow key={task.id} done={task.isCompleted} next={task.id === next?.id}>
              <LaunchTaskLabel task={task} />
            </PathRow>
          ))}
        </ol>
        {later.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            <FormattedMessage
              id="onboarding.home.later"
              defaultMessage="Later: {items}"
              values={{ items: intl.formatList(later, { type: 'conjunction' }) }}
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

/** A small, live picture of the portal: its name and brand, linking to it. */
function PortalSnapshot({ portalUrl, children }: { portalUrl?: string; children?: ReactNode }) {
  const settings = useWorkspaceSettings()
  const branding = (settings as { brandingData?: SettingsBrandingData } | undefined)?.brandingData
  const name = branding?.name ?? settings?.name ?? ''
  const logo = branding?.logoUrl ?? null
  const host = portalUrl ? new URL(portalUrl).host : null
  return (
    <div className="flex w-56 shrink-0 flex-col gap-2">
      <a
        href={portalUrl}
        aria-label={host ?? name}
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
