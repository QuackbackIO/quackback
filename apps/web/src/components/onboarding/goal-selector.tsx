import { FormattedMessage } from 'react-intl'
import {
  LightBulbIcon,
  ChatBubbleLeftRightIcon,
  BookOpenIcon,
  SignalIcon,
} from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { OnboardingOutcome } from '@/lib/shared/db-types'
import { cn } from '@/lib/shared/utils'

const options = [
  { id: 'product_feedback', label: 'Feedback & roadmap', icon: LightBulbIcon },
  { id: 'customer_support', label: 'Support inbox', icon: ChatBubbleLeftRightIcon },
  { id: 'help_center', label: 'Help center', icon: BookOpenIcon },
  { id: 'status_page', label: 'Status page', icon: SignalIcon },
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
          <Checkbox
            id="feedback-private"
            checked={feedbackPrivate}
            disabled={locked}
            onCheckedChange={(value) => onPrivateChange(value === true)}
          />
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
