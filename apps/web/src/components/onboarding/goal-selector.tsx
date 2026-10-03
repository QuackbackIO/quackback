import { FormattedMessage } from 'react-intl'
import type { SVGProps } from 'react'
import { LightBulbIcon, ChatBubbleLeftRightIcon, BookOpenIcon } from '@heroicons/react/24/outline'
import { CheckIcon } from '@heroicons/react/24/solid'
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
  { id: 'product_feedback', label: 'Feedback & roadmap', icon: LightBulbIcon },
  { id: 'customer_support', label: 'Support inbox', icon: ChatBubbleLeftRightIcon },
  { id: 'help_center', label: 'Help center', icon: BookOpenIcon },
  { id: 'status_page', label: 'Status page', icon: StatusPageIcon },
] as const

export function GoalSelector({
  goals,
  onGoalsChange,
  feedbackPrivate,
  onPrivateChange,
  disabled,
  managed = false,
}: {
  goals: OnboardingOutcome[]
  onGoalsChange: (goals: OnboardingOutcome[]) => void
  feedbackPrivate: boolean
  onPrivateChange: (value: boolean) => void
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
        <span className="ms-2 text-xs font-normal text-muted-foreground">
          {managed ? (
            <FormattedMessage
              id="onboarding.goals.managed"
              defaultMessage="Set by your config file"
            />
          ) : (
            <FormattedMessage id="onboarding.goals.pickAny" defaultMessage="Pick any" />
          )}
        </span>
      </legend>
      <div className="grid grid-cols-2 gap-3">
        {options.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            type="button"
            variant="outline"
            disabled={locked}
            aria-pressed={goals.includes(id)}
            className={cn(
              'h-auto justify-start gap-3 whitespace-normal p-4 text-start focus-visible:ring-zinc-400/50',
              goals.includes(id) && 'border-foreground bg-muted',
              managed && goals.includes(id) && 'disabled:opacity-100'
            )}
            onClick={() =>
              onGoalsChange(
                goals.includes(id) ? goals.filter((goal) => goal !== id) : [...goals, id]
              )
            }
          >
            <Icon className="size-5 shrink-0" />
            <FormattedMessage id={`onboarding.goals.${id}`} defaultMessage={label} />
          </Button>
        ))}
      </div>
      {goals.includes('product_feedback') && (
        <div className="flex items-center gap-2 pt-1">
          {/* Drawn like the shared Checkbox. That component's transition helpers
              share a chunk with the menus and popovers every page loads;
              reaching it from this route alone would split them out and add
              requests to those pages. */}
          <button
            type="button"
            role="checkbox"
            id="feedback-private"
            aria-checked={feedbackPrivate}
            data-slot="checkbox"
            data-checked={feedbackPrivate ? '' : undefined}
            disabled={locked}
            onClick={() => onPrivateChange(!feedbackPrivate)}
            className="peer grid size-4 shrink-0 place-content-center rounded-[4px] border border-input shadow-xs outline-none transition-shadow focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:bg-input/30 dark:data-checked:bg-primary"
          >
            {feedbackPrivate && <CheckIcon className="size-3.5" />}
          </button>
          <label htmlFor="feedback-private" className="text-sm">
            <FormattedMessage
              id="onboarding.goals.private"
              defaultMessage="Keep feedback private to my team"
            />
          </label>
        </div>
      )}
    </fieldset>
  )
}
