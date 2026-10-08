import { Fragment } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { CheckIcon } from '@heroicons/react/16/solid'
import { cn } from '@/lib/shared/utils'

export type SetupStepKey = 'account' | 'workspace' | 'ready'

const STEPS: { key: SetupStepKey; id: string; defaultMessage: string }[] = [
  { key: 'account', id: 'onboarding.steps.account', defaultMessage: 'Account' },
  { key: 'workspace', id: 'onboarding.steps.workspace', defaultMessage: 'Workspace' },
  { key: 'ready', id: 'onboarding.steps.ready', defaultMessage: 'Ready' },
]

/**
 * Where a first-time admin is in setup. Every step before the current one is
 * ticked, so finishing a step reads as progress rather than the screen just
 * changing. `finished` ticks the last step too.
 */
export function SetupSteps({
  current,
  finished = false,
}: {
  current: SetupStepKey
  finished?: boolean
}) {
  const intl = useIntl()
  const currentIndex = STEPS.findIndex((step) => step.key === current)
  return (
    <ol
      className="flex items-center gap-2.5 text-[13px]"
      aria-label={intl.formatMessage({
        id: 'onboarding.steps.label',
        defaultMessage: 'Setup steps',
      })}
    >
      {STEPS.map((step, index) => {
        const done = index < currentIndex || (finished && index === currentIndex)
        const active = index === currentIndex && !finished
        return (
          <Fragment key={step.key}>
            {index > 0 ? (
              <li aria-hidden="true" className="h-px w-5 shrink-0 bg-border sm:w-7" />
            ) : null}
            <li
              aria-current={index === currentIndex ? 'step' : undefined}
              className={cn(
                'flex min-w-0 items-center gap-2',
                active ? 'font-semibold text-foreground' : 'text-muted-foreground'
              )}
            >
              <span
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                  done && 'bg-foreground text-background',
                  active && 'border-[1.5px] border-foreground text-foreground',
                  !done && !active && 'border-[1.5px] border-border text-muted-foreground'
                )}
              >
                {done ? (
                  <CheckIcon
                    className="size-3 motion-safe:animate-in motion-safe:zoom-in-50"
                    aria-hidden="true"
                  />
                ) : (
                  index + 1
                )}
              </span>
              <span className={cn('truncate', !active && 'max-sm:sr-only')}>
                <FormattedMessage id={step.id} defaultMessage={step.defaultMessage} />
              </span>
              {done ? (
                <span className="sr-only">
                  <FormattedMessage id="onboarding.steps.done" defaultMessage="(done)" />
                </span>
              ) : null}
            </li>
          </Fragment>
        )
      })}
    </ol>
  )
}
