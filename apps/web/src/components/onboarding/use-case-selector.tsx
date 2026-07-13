'use client'

import {
  LightBulbIcon,
  ChatBubbleLeftRightIcon,
  BookOpenIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline'
import {
  normalizeOnboardingOutcome,
  type UseCaseType,
  type OnboardingOutcome,
} from '@/lib/shared/db-types'
import { Badge } from '@/components/ui/badge'
import type { ComponentType } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'

interface OutcomeOption {
  id: OnboardingOutcome
  label: string
  description: string
  /** Who this is for — ICP cue, not jargon */
  forWhom: string
  icon: ComponentType<{ className?: string }>
}

/**
 * Outcome-first picker, modeled on how Intercom / Featurebase / Statuspage
 * ICPs actually buy:
 *
 *  - Product feedback  → Featurebase / Canny PM & founder ICP
 *  - Customer support  → Intercom support / CX ICP
 *  - Help center       → Self-serve / deflect volume
 *  - Internal          → Employee voice / ops feedback
 *
 * Stored as setupState.useCase. Legacy saas|consumer|marketplace map in
 * display via normalizeOnboardingOutcome.
 */
const OUTCOME_OPTIONS: OutcomeOption[] = [
  {
    id: 'product_feedback',
    label: 'Product feedback',
    description: 'Collect ideas, prioritize requests, and share what’s coming next',
    forWhom: 'Product teams',
    icon: LightBulbIcon,
  },
  {
    id: 'customer_support',
    label: 'Customer support',
    description: 'Talk with customers and manage conversations in a shared inbox',
    forWhom: 'Support teams',
    icon: ChatBubbleLeftRightIcon,
  },
  {
    id: 'help_center',
    label: 'Help Center',
    description: 'Publish answers customers can find whenever they need them',
    forWhom: 'Support & content',
    icon: BookOpenIcon,
  },
  {
    id: 'internal',
    label: 'Internal feedback',
    description: 'Give teammates a private place to share ideas and improvements',
    forWhom: 'Your team',
    icon: UserGroupIcon,
  },
]

interface UseCaseSelectorProps {
  value: UseCaseType | undefined
  onChange: (value: UseCaseType) => void
  disabled?: boolean
}

export function UseCaseSelector({ value, onChange, disabled }: UseCaseSelectorProps) {
  const intl = useIntl()
  const displayValue = normalizeOnboardingOutcome(value)

  return (
    <div
      className="mx-auto max-w-md space-y-2"
      role="radiogroup"
      aria-label={intl.formatMessage({
        id: 'onboarding.goal.groupLabel',
        defaultMessage: 'Workspace goal',
      })}
    >
      {OUTCOME_OPTIONS.map((option) => {
        const isSelected = displayValue === option.id
        const Icon = option.icon
        return (
          <label
            key={option.id}
            className={`
              relative w-full flex min-h-11 items-center gap-4 p-4
              rounded-xl border transition-all duration-200 motion-reduce:transition-none
              focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2
              ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
              ${
                isSelected
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border/50 bg-card/50 hover:border-border hover:bg-card/80'
              }
            `}
          >
            <input
              type="radio"
              name="workspace-goal"
              value={option.id}
              checked={isSelected}
              onChange={() => onChange(option.id)}
              disabled={disabled}
              className="sr-only"
            />
            <div
              className={`
              shrink-0 p-2.5 rounded-lg transition-colors motion-reduce:transition-none
              ${isSelected ? 'bg-primary/10' : 'bg-muted/50'}
            `}
            >
              <Icon
                className={`h-5 w-5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}
              />
            </div>

            <div className="text-left min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <div
                  className={`font-medium text-sm ${isSelected ? 'text-foreground' : 'text-foreground/90'}`}
                >
                  <FormattedMessage
                    id={`onboarding.goal.${option.id}.label`}
                    defaultMessage={option.label}
                  />
                </div>
                <Badge size="sm" shape="pill" variant="secondary">
                  <FormattedMessage
                    id={`onboarding.goal.${option.id}.audience`}
                    defaultMessage={option.forWhom}
                  />
                </Badge>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                <FormattedMessage
                  id={`onboarding.goal.${option.id}.description`}
                  defaultMessage={option.description}
                />
              </div>
            </div>
          </label>
        )
      })}
    </div>
  )
}
