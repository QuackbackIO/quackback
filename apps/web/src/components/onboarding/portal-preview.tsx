import { useIntl } from 'react-intl'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import type { OnboardingOutcome } from '@/lib/shared/db-types'
import { newWorkspaceFlagsForGoals } from '@/lib/shared/types/settings'
import { cn } from '@/lib/shared/utils'
import { SetupPencilIcon } from './setup-icons'

type Message = { id: string; defaultMessage: string }

const TAB = {
  feedback: { id: 'onboarding.preview.feedback', defaultMessage: 'Feedback' },
  roadmap: { id: 'onboarding.preview.roadmap', defaultMessage: 'Roadmap' },
  changelog: { id: 'onboarding.preview.changelog', defaultMessage: 'Changelog' },
  help: { id: 'onboarding.preview.help', defaultMessage: 'Help center' },
  support: { id: 'onboarding.preview.support', defaultMessage: 'Support' },
  status: { id: 'onboarding.preview.status', defaultMessage: 'Status' },
} satisfies Record<string, Message>

/** Sample ideas for the example portal. Never written anywhere. */
const IDEAS = [
  {
    title: { id: 'onboarding.preview.ideaDarkMode', defaultMessage: 'Dark mode' },
    state: { id: 'onboarding.preview.planned', defaultMessage: 'Planned' },
    votes: 42,
  },
  {
    title: { id: 'onboarding.preview.ideaExport', defaultMessage: 'Export to CSV' },
    state: { id: 'onboarding.preview.underReview', defaultMessage: 'Under review' },
    votes: 31,
  },
  {
    title: { id: 'onboarding.preview.ideaSlack', defaultMessage: 'Slack notifications' },
    state: { id: 'onboarding.preview.open', defaultMessage: 'Open' },
    votes: 18,
  },
] satisfies Array<{ title: Message; state: Message; votes: number }>

/**
 * The portal tabs a new workspace starts with for these goals, in the portal's
 * own order. Read from the flags setup itself writes, so the preview cannot
 * promise a tab the workspace will not have.
 */
function tabsForGoals(goals: OnboardingOutcome[]): Message[] {
  const flags = newWorkspaceFlagsForGoals(goals)
  return [
    ...(flags.feedback ? [TAB.feedback, TAB.roadmap] : []),
    ...(flags.changelog ? [TAB.changelog] : []),
    ...(flags.helpCenter ? [TAB.help] : []),
    ...(flags.supportTickets ? [TAB.support] : []),
    ...(flags.statusPage ? [TAB.status] : []),
  ]
}

/**
 * A light mock of the customer-facing portal in browser chrome.
 *
 * - `example`: a busy portal with sample ideas, for screens that say it is an
 *   example.
 * - `goals`: the portal as the admin chooses, with a section for each picked
 *   goal, so it changes as they pick.
 * - `live`: the portal just created, as a customer opening it sees it now:
 *   its real tabs and its empty board.
 *
 * The mock is a picture, so it is hidden from assistive tech and described in
 * one sentence instead.
 */
export function PortalPreview({
  name,
  goals = ['product_feedback'],
  hostname,
  variant = 'goals',
  className,
}: {
  /** The workspace name, or empty before one is typed. */
  name: string
  goals?: OnboardingOutcome[]
  hostname?: string | null
  variant?: 'example' | 'goals' | 'live'
  className?: string
}) {
  const intl = useIntl()
  const shownName =
    name ||
    intl.formatMessage({
      id: 'onboarding.preview.placeholderName',
      defaultMessage: 'Your workspace',
    })
  const tabs =
    variant === 'example'
      ? [TAB.feedback, TAB.roadmap, TAB.changelog, TAB.help]
      : tabsForGoals(goals)
  const tabList = intl.formatList(tabs.map((tab) => intl.formatMessage(tab)))
  const feedback = variant === 'example' || goals.includes('product_feedback')
  const help = goals.includes('help_center')
  const status = goals.includes('status_page')

  return (
    <div className={cn('relative w-full', className)}>
      <p className="sr-only">
        {variant === 'example'
          ? intl.formatMessage({
              id: 'onboarding.preview.exampleDescription',
              defaultMessage: 'An example portal with sample ideas.',
            })
          : name
            ? intl.formatMessage(
                {
                  id: 'onboarding.preview.description',
                  defaultMessage: 'Portal preview for {name}. Tabs: {tabs}.',
                },
                { name, tabs: tabList }
              )
            : intl.formatMessage(
                {
                  id: 'onboarding.preview.descriptionUnnamed',
                  defaultMessage: 'Portal preview. Tabs: {tabs}.',
                },
                { tabs: tabList }
              )}
      </p>
      <div
        aria-hidden="true"
        className="flex w-full flex-col overflow-hidden rounded-2xl border border-zinc-300 bg-white text-zinc-900 shadow-[0_30px_80px_rgba(0,0,0,0.35)] dark:border-zinc-800"
      >
        <div className="flex h-11 shrink-0 items-center gap-3.5 border-b border-zinc-200 bg-zinc-100 px-4">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-zinc-300" />
            <span className="size-2.5 rounded-full bg-zinc-300" />
            <span className="size-2.5 rounded-full bg-zinc-300" />
          </div>
          <div className="flex h-[26px] min-w-0 flex-1 items-center rounded-lg border border-zinc-200 bg-white px-3 font-mono text-[12.5px] text-zinc-700">
            <span className="truncate">{hostname}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 px-7 pt-5">
          <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-primary text-base font-extrabold text-primary-foreground">
            {shownName.charAt(0).toUpperCase()}
          </span>
          <span className="truncate text-lg font-bold">{shownName}</span>
          <span className="ml-auto flex h-8 shrink-0 items-center rounded-full bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground">
            {intl.formatMessage({ id: 'onboarding.preview.signIn', defaultMessage: 'Sign in' })}
          </span>
        </div>
        <div className="flex gap-1 overflow-hidden border-b border-zinc-100 px-6 pt-3.5">
          {tabs.map((tab, index) => (
            <span
              key={tab.id}
              data-preview-tab
              className={cn(
                'shrink-0 border-b-2 px-3 py-2 text-[13.5px] whitespace-nowrap',
                index === 0 ? 'border-zinc-900 font-semibold' : 'border-transparent text-zinc-500'
              )}
            >
              {intl.formatMessage(tab)}
            </span>
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-3 bg-zinc-50 px-7 pt-[22px] pb-7">
          {variant === 'example' ? (
            <ExampleBoard name={name} />
          ) : variant === 'live' ? (
            <LiveHome name={name} feedback={feedback} tabs={tabs} />
          ) : (
            <>
              {feedback ? <EmptyBoard name={name} /> : null}
              {help ? <HelpHero /> : null}
              {status ? <StatusBar /> : null}
              {!feedback && !help && !status ? <Welcome name={name} /> : null}
              {goals.includes('customer_support') ? <MessengerTeaser name={shownName} /> : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** A busy board, for the example portal only. */
function ExampleBoard({ name }: { name: string }) {
  const intl = useIntl()
  return (
    <>
      <p className="text-2xl font-extrabold tracking-[-0.02em]">
        {name
          ? intl.formatMessage(
              {
                id: 'onboarding.preview.feedbackTitle',
                defaultMessage: 'What should {name} build next?',
              },
              { name }
            )
          : intl.formatMessage({
              id: 'onboarding.preview.feedbackTitleUnnamed',
              defaultMessage: 'What should we build next?',
            })}
      </p>
      <div className="flex h-[42px] items-center rounded-[10px] border border-zinc-200 bg-white px-3.5 text-sm text-zinc-500">
        {intl.formatMessage({
          id: 'onboarding.preview.shareIdea',
          defaultMessage: 'Share an idea…',
        })}
      </div>
      {IDEAS.map((idea) => (
        <div
          key={idea.title.id}
          className="flex items-center gap-3.5 rounded-xl border border-zinc-100 bg-white p-3.5"
        >
          <div className="flex h-12 w-11 shrink-0 flex-col items-center justify-center rounded-[10px] border border-zinc-200 text-sm font-semibold">
            <span className="text-[11px] text-zinc-500">▲</span>
            {idea.votes}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-[15px] font-semibold">
              {intl.formatMessage(idea.title)}
            </span>
            <span className="text-[12.5px] text-zinc-500">{intl.formatMessage(idea.state)}</span>
          </div>
        </div>
      ))}
    </>
  )
}

/** The board a new workspace opens with: a composer and nothing posted yet. */
function EmptyBoard({ name }: { name: string }) {
  const intl = useIntl()
  return (
    <>
      <div className="flex h-[52px] items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 text-[15px] text-zinc-500">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/15 text-zinc-900">
          <SetupPencilIcon className="size-4" />
        </span>
        {intl.formatMessage({
          id: 'onboarding.preview.composer',
          defaultMessage: 'What’s your idea?',
        })}
      </div>
      <div className="flex flex-col items-center gap-1 px-4 py-7 text-center">
        <p className="text-[15px] font-semibold">
          {intl.formatMessage({
            id: 'onboarding.preview.emptyTitle',
            defaultMessage: 'Got an idea? Be the first to share it',
          })}
        </p>
        <p className="text-[13px] text-zinc-500">
          {name
            ? intl.formatMessage(
                {
                  id: 'onboarding.preview.emptyBody',
                  defaultMessage: 'The {name} team reads every request.',
                },
                { name }
              )
            : intl.formatMessage({
                id: 'onboarding.preview.emptyBodyUnnamed',
                defaultMessage: 'Your team reads every request.',
              })}
        </p>
      </div>
    </>
  )
}

/**
 * The portal home a new workspace really shows: the empty board when it has
 * one, otherwise a pointer to each of its other pages.
 */
function LiveHome({ name, feedback, tabs }: { name: string; feedback: boolean; tabs: Message[] }) {
  const intl = useIntl()
  if (feedback) return <EmptyBoard name={name} />
  const elsewhere = tabs.filter((tab) => tab !== TAB.feedback && tab !== TAB.roadmap)
  if (elsewhere.length === 0) return <Welcome name={name} />
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-8 text-center">
      <p className="text-lg font-semibold">
        {intl.formatMessage({
          id: 'onboarding.preview.helpTitle',
          defaultMessage: 'How can we help?',
        })}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {elsewhere.map((tab) => (
          <span
            key={tab.id}
            className="rounded-lg border border-zinc-200 bg-white px-3.5 py-1.5 text-[13px] font-medium"
          >
            {intl.formatMessage(tab)}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The help center's search hero, tinted rather than a block of solid brand colour. */
function HelpHero() {
  const intl = useIntl()
  return (
    <div className="flex flex-col gap-3 rounded-[14px] bg-primary/15 p-[22px]">
      <p className="text-xl font-extrabold">
        {intl.formatMessage({
          id: 'onboarding.preview.helpTitle',
          defaultMessage: 'How can we help?',
        })}
      </p>
      <div className="flex h-10 items-center rounded-[10px] border border-zinc-200 bg-white px-3.5 text-sm text-zinc-500">
        {intl.formatMessage({
          id: 'onboarding.preview.searchArticles',
          defaultMessage: 'Search articles',
        })}
      </div>
    </div>
  )
}

function StatusBar() {
  const intl = useIntl()
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-green-200 bg-green-50 px-3.5 py-3 text-sm font-medium text-green-800">
      <span className="size-2 rounded-full bg-green-600" />
      {intl.formatMessage({
        id: 'onboarding.preview.operational',
        defaultMessage: 'All systems operational',
      })}
    </div>
  )
}

function Welcome({ name }: { name: string }) {
  const intl = useIntl()
  return (
    <p className="text-2xl font-extrabold tracking-[-0.02em]">
      {name
        ? intl.formatMessage(
            { id: 'onboarding.preview.welcomeTitle', defaultMessage: 'Welcome to {name}' },
            { name }
          )
        : intl.formatMessage({
            id: 'onboarding.preview.welcomeTitleUnnamed',
            defaultMessage: 'Welcome to your portal',
          })}
    </p>
  )
}

/**
 * Messenger's greeting and launcher, in a row of their own at the foot of the
 * page, so they never sit over the help center search, the status bar or the
 * header's Sign in.
 */
function MessengerTeaser({ name }: { name: string }) {
  const intl = useIntl()
  return (
    <div className="flex items-end justify-end gap-3 pt-1">
      <div className="max-w-[240px] min-w-0 rounded-[14px] border border-zinc-200 bg-white px-3.5 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.12)]">
        <p className="mb-1 truncate text-[13px] font-semibold">{name}</p>
        <p className="text-[13px] text-zinc-700">
          {intl.formatMessage({
            id: 'onboarding.preview.messenger',
            defaultMessage: 'Hi there. How can we help?',
          })}
        </p>
      </div>
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary shadow-[0_8px_20px_rgba(0,0,0,0.18)]">
        <ChatBubbleLeftRightIcon className="size-6 text-primary-foreground" />
      </span>
    </div>
  )
}
