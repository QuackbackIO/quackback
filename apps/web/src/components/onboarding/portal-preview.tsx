import { useIntl } from 'react-intl'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import type { OnboardingOutcome } from '@/lib/shared/db-types'
import { cn } from '@/lib/shared/utils'

type Message = { id: string; defaultMessage: string }

const TAB = {
  feedback: { id: 'onboarding.preview.feedback', defaultMessage: 'Feedback' },
  roadmap: { id: 'onboarding.preview.roadmap', defaultMessage: 'Roadmap' },
  changelog: { id: 'onboarding.preview.changelog', defaultMessage: 'Changelog' },
  help: { id: 'onboarding.preview.help', defaultMessage: 'Help' },
  status: { id: 'onboarding.preview.status', defaultMessage: 'Status' },
  home: { id: 'onboarding.preview.home', defaultMessage: 'Home' },
} satisfies Record<string, Message>

/** Placeholder ideas that make the mock read as a portal. Never written anywhere. */
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
 * A light mock of the customer-facing portal in browser chrome, the same mock
 * cloud signup shows. With `variant="overview"` it shows the whole portal;
 * with `variant="goals"` its tabs, Help, Status and Messenger follow the
 * picked goals, so the preview changes as the admin chooses.
 */
export function PortalPreview({
  name,
  goals = ['product_feedback'],
  hostname,
  variant = 'goals',
  className,
}: {
  name: string
  goals?: OnboardingOutcome[]
  hostname?: string | null
  variant?: 'overview' | 'goals'
  className?: string
}) {
  const intl = useIntl()
  const feedback = variant === 'overview' || goals.includes('product_feedback')
  const help = variant === 'goals' && goals.includes('help_center')
  const status = variant === 'goals' && goals.includes('status_page')
  const support = variant === 'goals' && goals.includes('customer_support')
  const tabs: Message[] =
    variant === 'overview'
      ? [TAB.feedback, TAB.roadmap, TAB.changelog, TAB.help]
      : [
          ...(feedback ? [TAB.feedback, TAB.roadmap] : []),
          ...(help ? [TAB.help] : []),
          ...(status ? [TAB.status] : []),
        ]
  if (!tabs.length) tabs.push(TAB.home)
  const ideas = variant === 'overview' ? IDEAS : IDEAS.slice(0, 2)

  return (
    <section
      aria-label={intl.formatMessage({
        id: 'onboarding.preview.label',
        defaultMessage: 'Portal preview',
      })}
      className={cn(
        'relative flex w-full flex-col overflow-hidden rounded-2xl border border-zinc-300 bg-white text-zinc-900 shadow-[0_30px_80px_rgba(0,0,0,0.35)] dark:border-zinc-800',
        className
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-3.5 border-b border-zinc-200 bg-zinc-100 px-4">
        <div className="flex gap-1.5" aria-hidden="true">
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
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="truncate text-lg font-bold">{name}</span>
        <span className="ml-auto flex h-8 shrink-0 items-center rounded-full bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground">
          {intl.formatMessage({ id: 'onboarding.preview.signIn', defaultMessage: 'Sign in' })}
        </span>
      </div>
      <div className="flex gap-1 border-b border-zinc-100 px-6 pt-3.5">
        {tabs.map((tab, index) => (
          <span
            key={tab.id}
            className={cn(
              'border-b-2 px-3 py-2 text-[13.5px]',
              index === 0 ? 'border-zinc-900 font-semibold' : 'border-transparent text-zinc-500'
            )}
          >
            {intl.formatMessage(tab)}
          </span>
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-3 bg-zinc-50 px-7 pt-[22px] pb-7">
        {feedback ? (
          <>
            <h2 className="text-2xl font-extrabold tracking-[-0.02em]">
              {intl.formatMessage(
                {
                  id: 'onboarding.preview.feedbackTitle',
                  defaultMessage: 'What should {name} build next?',
                },
                { name }
              )}
            </h2>
            <div className="flex h-[42px] items-center rounded-[10px] border border-zinc-200 bg-white px-3.5 text-sm text-zinc-500">
              {intl.formatMessage({
                id: 'onboarding.preview.shareIdea',
                defaultMessage: 'Share an idea…',
              })}
            </div>
            {ideas.map((idea) => (
              <div
                key={idea.title.id}
                className="flex items-center gap-3.5 rounded-xl border border-zinc-100 bg-white p-3.5"
              >
                <div className="flex h-12 w-11 shrink-0 flex-col items-center justify-center rounded-[10px] border border-zinc-200 text-sm font-semibold">
                  <span aria-hidden="true" className="text-[11px] text-zinc-500">
                    ▲
                  </span>
                  {idea.votes}
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-[15px] font-semibold">
                    {intl.formatMessage(idea.title)}
                  </span>
                  <span className="text-[12.5px] text-zinc-500">
                    {intl.formatMessage(idea.state)}
                  </span>
                </div>
              </div>
            ))}
          </>
        ) : null}
        {help ? (
          <div className="flex flex-col gap-3 rounded-[14px] bg-primary p-[22px] text-primary-foreground">
            <h2 className="text-xl font-extrabold">
              {intl.formatMessage({
                id: 'onboarding.preview.helpTitle',
                defaultMessage: 'How can we help?',
              })}
            </h2>
            <div className="flex h-10 items-center rounded-[10px] bg-white px-3.5 text-sm text-zinc-500">
              {intl.formatMessage({
                id: 'onboarding.preview.searchArticles',
                defaultMessage: 'Search articles',
              })}
            </div>
          </div>
        ) : null}
        {status ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-green-200 bg-green-50 px-3.5 py-3 text-sm font-medium text-green-800">
            <span aria-hidden="true" className="size-2 rounded-full bg-green-600" />
            {intl.formatMessage({
              id: 'onboarding.preview.operational',
              defaultMessage: 'All systems operational',
            })}
          </div>
        ) : null}
        {!feedback && !help && !status ? (
          <h2 className="text-2xl font-extrabold tracking-[-0.02em]">
            {intl.formatMessage(
              { id: 'onboarding.preview.welcomeTitle', defaultMessage: 'Welcome to {name}' },
              { name }
            )}
          </h2>
        ) : null}
      </div>
      {support ? (
        <div className="absolute right-[22px] bottom-[22px] flex flex-col items-end gap-3">
          <div className="w-[250px] rounded-[14px] border border-zinc-200 bg-white p-3.5 shadow-[0_12px_30px_rgba(0,0,0,0.12)]">
            <p className="mb-1.5 truncate text-[13px] font-semibold">{name}</p>
            <p className="text-[13px] text-zinc-700">
              {intl.formatMessage({
                id: 'onboarding.preview.messenger',
                defaultMessage: 'Hi there. How can we help?',
              })}
            </p>
          </div>
          <span
            aria-hidden="true"
            className="grid size-[50px] place-items-center rounded-full bg-primary shadow-[0_8px_20px_rgba(0,0,0,0.18)]"
          >
            <ChatBubbleLeftRightIcon className="size-6 text-primary-foreground" />
          </span>
        </div>
      ) : null}
    </section>
  )
}
