import { FormattedMessage } from 'react-intl'
import type { SVGProps } from 'react'
import { LightBulbIcon, ChatBubbleLeftRightIcon, BookOpenIcon } from '@heroicons/react/24/outline'
import { CheckCircleIcon } from '@heroicons/react/20/solid'
import { Button } from '@/components/ui/button'
import type { OnboardingOutcome } from '@/lib/shared/db-types'
import { cn } from '@/lib/shared/utils'

/**
 * The outline signal icon, drawn here rather than imported. The shared icon
 * module lives inside the workflow builder's chunk; importing it from this
 * route would split it into a chunk of its own and add a request to every
 * page that loads the builder.
 */
function StatusPageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden="true"
      data-slot="icon"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
      />
    </svg>
  )
}

const options = [
  {
    id: 'product_feedback',
    label: 'Feedback & roadmap',
    description: 'Collect ideas and votes, and share what you plan to build.',
    icon: LightBulbIcon,
  },
  {
    id: 'customer_support',
    label: 'Support inbox',
    description: 'Chat with customers and answer email in one shared inbox.',
    icon: ChatBubbleLeftRightIcon,
  },
  {
    id: 'help_center',
    label: 'Help center',
    description: 'Publish articles customers can search before they ask.',
    icon: BookOpenIcon,
  },
  {
    id: 'status_page',
    label: 'Status page',
    description: 'Tell customers when something is down, and when it is fixed.',
    icon: StatusPageIcon,
  },
] as const

export function GoalSelector({
  goals,
  onGoalsChange,
  disabled,
  managed = false,
}: {
  goals: OnboardingOutcome[]
  onGoalsChange: (goals: OnboardingOutcome[]) => void
  disabled?: boolean
  /** A config file sets the goals: show its picks, read-only. */
  managed?: boolean
}) {
  const locked = disabled || managed
  return (
    <fieldset disabled={locked} className="space-y-3">
      <legend className="mb-3 text-sm font-medium">
        <FormattedMessage
          id="onboarding.goals.title"
          defaultMessage="What do you want to run first?"
        />
        {/* Polite live region: the hint turns into "Pick at least one" when
            the last goal is removed, and the step cannot continue without one. */}
        <span aria-live="polite" className="ms-2 text-xs font-normal text-muted-foreground">
          {managed ? (
            <FormattedMessage
              id="onboarding.goals.managed"
              defaultMessage="Set by your config file"
            />
          ) : goals.length === 0 ? (
            <span className="text-foreground">
              <FormattedMessage id="onboarding.goals.pickOne" defaultMessage="Pick at least one" />
            </span>
          ) : (
            <FormattedMessage id="onboarding.goals.pickAny" defaultMessage="Pick any" />
          )}
        </span>
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map(({ id, label, description, icon: Icon }) => {
          const picked = goals.includes(id)
          return (
            <Button
              key={id}
              type="button"
              variant="outline"
              disabled={locked}
              aria-pressed={picked}
              aria-labelledby={`goal-${id}-label`}
              aria-describedby={`goal-${id}-description`}
              className={cn(
                'relative h-auto flex-col items-start justify-start gap-2 whitespace-normal rounded-[14px]! p-4 text-start focus-visible:ring-zinc-400/50',
                picked && 'border-foreground bg-muted',
                managed && picked && 'disabled:opacity-100'
              )}
              onClick={() =>
                onGoalsChange(picked ? goals.filter((goal) => goal !== id) : [...goals, id])
              }
            >
              <span className="flex w-full items-center gap-2.5">
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                <span id={`goal-${id}-label`} className="font-semibold">
                  <FormattedMessage id={`onboarding.goals.${id}`} defaultMessage={label} />
                </span>
                {picked ? (
                  <CheckCircleIcon
                    className="ms-auto size-5 shrink-0 motion-safe:animate-in motion-safe:zoom-in-50"
                    aria-hidden="true"
                  />
                ) : null}
              </span>
              <span
                id={`goal-${id}-description`}
                className="text-[13px] leading-snug font-normal text-muted-foreground"
              >
                <FormattedMessage
                  id={`onboarding.goals.${id}.description`}
                  defaultMessage={description}
                />
              </span>
            </Button>
          )
        })}
      </div>
      {managed ? null : (
        <p className="text-xs text-muted-foreground">
          <FormattedMessage
            id="onboarding.goals.later"
            defaultMessage="You can turn any of these on or off later in Settings."
          />
        </p>
      )}
    </fieldset>
  )
}
