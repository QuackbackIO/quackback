import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FormattedMessage } from 'react-intl'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  OnboardingHeading,
  OnboardingLead,
  SetupActions,
} from '@/components/onboarding/onboarding-split'
import { SetupSteps } from '@/components/onboarding/setup-steps'
import { SetupCheckIcon, SetupWarningIcon } from '@/components/onboarding/setup-icons'
import { getInstallChecksFn } from '@/lib/server/functions/onboarding'
import type { InstallChecks } from '@/lib/server/install-checks'
import type { OnboardingOutcome } from '@/lib/shared/db-types'
import { cn } from '@/lib/shared/utils'

/** What each goal sets up when the workspace is saved (applyOnboardingGoals). */
const GOAL_RESULTS: Partial<Record<OnboardingOutcome, { id: string; defaultMessage: string }>> = {
  product_feedback: {
    id: 'onboarding.ready.made.feedback',
    defaultMessage: 'A Feedback board customers can post and vote on',
  },
  customer_support: {
    id: 'onboarding.ready.made.support',
    defaultMessage: 'A support inbox, with Messenger ready for your website',
  },
  help_center: {
    id: 'onboarding.ready.made.help',
    defaultMessage: 'A help center with a General category',
  },
  status_page: {
    id: 'onboarding.ready.made.status',
    defaultMessage: 'A published status page',
  },
}

/** A list row: the loaded rows and their loading placeholders share it. */
const ROW = 'flex items-start gap-3 text-[15px] leading-normal'

/** Past this many characters the headline steps down a size. */
const LONG_NAME = 20

/** Stagger the list in, one row after another. */
function rowAnimation(index: number) {
  return {
    className:
      'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300',
    style: { animationDelay: `${150 + index * 90}ms`, animationFillMode: 'both' as const },
  }
}

/**
 * The last setup step: what was just made, whether the install has what it
 * needs, and the way in.
 *
 * Shown once, straight after the workspace is saved, so finishing setup has a
 * moment of its own instead of the page simply turning into Home. The install
 * checks are the self-hosted operator's: each names something that fails
 * quietly later if it is missing.
 */
export function ReadyStep({
  workspaceName,
  goals,
  adminName,
}: {
  workspaceName: string
  goals: OnboardingOutcome[]
  adminName?: string | null
}) {
  const navigate = useNavigate()
  const [checks, setChecks] = useState<InstallChecks | null | 'loading'>('loading')
  const [opening, setOpening] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)

  // This step replaces the workspace form in place, wherever that form was
  // scrolled to. Start it at the top, with focus on its heading, so it is
  // seen and announced as the new screen it is.
  useEffect(() => {
    window.scrollTo({ top: 0 })
    heading.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    let live = true
    getInstallChecksFn()
      .then((result) => live && setChecks(result))
      .catch(() => live && setChecks(null))
    return () => {
      live = false
    }
  }, [])

  const made = [
    adminName
      ? {
          key: 'admin',
          node: (
            <FormattedMessage
              id="onboarding.ready.made.adminNamed"
              defaultMessage="An admin account for {name}"
              values={{ name: adminName }}
            />
          ),
        }
      : {
          key: 'admin',
          node: (
            <FormattedMessage
              id="onboarding.ready.made.admin"
              defaultMessage="Your admin account"
            />
          ),
        },
    ...goals.flatMap((goal) => {
      const result = GOAL_RESULTS[goal]
      return result ? [{ key: goal, node: <FormattedMessage {...result} /> }] : []
    }),
  ]

  return (
    <div className="flex flex-col">
      <SetupSteps current="ready" finished />
      <CheckCircleIcon
        className="mt-8 size-12 text-primary motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500"
        aria-hidden="true"
      />
      <div className="mt-5">
        <OnboardingHeading
          ref={heading}
          tabIndex={-1}
          className={cn(
            'break-words text-balance',
            workspaceName.length > LONG_NAME && 'text-[30px] leading-[1.1] sm:text-[32px]'
          )}
        >
          <FormattedMessage
            id="onboarding.ready.title"
            defaultMessage="{name} is ready"
            values={{ name: workspaceName }}
          />
        </OnboardingHeading>
        <OnboardingLead>
          <FormattedMessage
            id="onboarding.ready.lead"
            defaultMessage="Here’s what’s set up. The launch plan on Home walks you through the rest."
          />
        </OnboardingLead>
      </div>

      <section className="mt-7 max-w-[440px]">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <FormattedMessage id="onboarding.ready.madeTitle" defaultMessage="Set up for you" />
        </h2>
        <ul className="mt-3 flex flex-col gap-2.5">
          {made.map((row, index) => (
            <li
              key={row.key}
              style={rowAnimation(index).style}
              className={cn(ROW, rowAnimation(index).className)}
            >
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-foreground text-background">
                <SetupCheckIcon className="size-3.5" aria-hidden="true" />
              </span>
              <span>{row.node}</span>
            </li>
          ))}
        </ul>
      </section>

      {checks === null ? null : <InstallSection checks={checks} offset={made.length} />}

      <SetupActions className="mt-8 max-w-[440px]">
        <Button
          type="button"
          disabled={opening}
          onClick={() => {
            setOpening(true)
            void navigate({ to: '/admin' })
          }}
          className="h-12 w-full rounded-full text-base"
        >
          <FormattedMessage
            id="onboarding.ready.openWorkspace"
            defaultMessage="Open your workspace"
          />
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">
          <FormattedMessage
            id="onboarding.ready.openHint"
            defaultMessage="Opens Home with your launch plan."
          />
        </p>
      </SetupActions>
    </div>
  )
}

function InstallSection({ checks, offset }: { checks: InstallChecks | 'loading'; offset: number }) {
  if (checks === 'loading') {
    // One placeholder per check, in the loaded rows' shape, so the section
    // keeps its height and the button below does not move when they resolve.
    return (
      <section className="mt-7 max-w-[440px]" aria-busy="true">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <FormattedMessage id="onboarding.ready.installTitle" defaultMessage="Your install" />
        </h2>
        <p role="status" className="sr-only">
          <FormattedMessage
            id="onboarding.ready.checking"
            defaultMessage="Checking your install…"
          />
        </p>
        <ul aria-hidden="true" className="mt-3 flex flex-col gap-3">
          {[60, 52, 70].map((width) => (
            <li key={width} data-skeleton-row className={ROW}>
              <span className="mt-0.5 size-5 shrink-0 rounded-full bg-muted motion-safe:animate-pulse" />
              <span className="flex h-[1lh] grow items-center">
                <span
                  className="h-3 rounded-full bg-muted motion-safe:animate-pulse"
                  style={{ width: `${width}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
        <p aria-hidden="true" className="mt-3 h-[1lh] text-sm" />
      </section>
    )
  }

  const rows = [
    checks.email
      ? {
          key: 'email',
          ok: true,
          title: (
            <FormattedMessage id="onboarding.ready.email.ok" defaultMessage="Email is set up" />
          ),
        }
      : {
          key: 'email',
          ok: false,
          title: (
            <FormattedMessage
              id="onboarding.ready.email.missing"
              defaultMessage="Email isn’t set up yet"
            />
          ),
          detail: (
            <FormattedMessage
              id="onboarding.ready.email.missingDetail"
              defaultMessage="Invites and password resets can’t be sent until you add SMTP, Amazon SES or Resend settings and restart Quackback."
            />
          ),
        },
    checks.storage
      ? {
          key: 'storage',
          ok: true,
          title: (
            <FormattedMessage
              id="onboarding.ready.storage.ok"
              defaultMessage="File uploads are set up"
            />
          ),
        }
      : {
          key: 'storage',
          ok: false,
          title: (
            <FormattedMessage
              id="onboarding.ready.storage.missing"
              defaultMessage="File uploads aren’t set up yet"
            />
          ),
          detail: (
            <FormattedMessage
              id="onboarding.ready.storage.missingDetail"
              defaultMessage="Logos, avatars and attachments need S3-compatible storage."
            />
          ),
        },
    {
      key: 'address',
      ok: checks.address.ok,
      title: (
        <FormattedMessage
          id="onboarding.ready.address"
          defaultMessage="Links point to {url}"
          values={{ url: <span className="font-mono text-[13px]">{checks.address.baseUrl}</span> }}
        />
      ),
      detail:
        !checks.address.ok && checks.address.visitedOrigin ? (
          <FormattedMessage
            id="onboarding.ready.address.mismatch"
            defaultMessage="You opened Quackback at {visited}. If that’s the address people will use, set BASE_URL to it and restart."
            values={{
              visited: (
                <span className="font-mono text-[12px]">{checks.address.visitedOrigin}</span>
              ),
            }}
          />
        ) : undefined,
    },
  ]
  const allOk = rows.every((row) => row.ok)

  return (
    <section className="mt-7 max-w-[440px]">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <FormattedMessage id="onboarding.ready.installTitle" defaultMessage="Your install" />
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((row, index) => (
          <li
            key={row.key}
            style={rowAnimation(offset + index).style}
            className={cn(ROW, rowAnimation(offset + index).className)}
          >
            {row.ok ? (
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-foreground text-background">
                <SetupCheckIcon className="size-3.5" aria-hidden="true" />
              </span>
            ) : (
              <SetupWarningIcon
                className="mt-0.5 size-5 shrink-0 text-amber-500"
                aria-hidden="true"
              />
            )}
            <span className="min-w-0">
              <span className="block break-words">{row.title}</span>
              {row.detail ? (
                <span className="mt-1 block text-[13px] leading-snug text-muted-foreground">
                  {row.detail}
                </span>
              ) : null}
              <span className="sr-only">
                {row.ok ? (
                  <FormattedMessage id="onboarding.ready.check.ok" defaultMessage="(ready)" />
                ) : (
                  <FormattedMessage
                    id="onboarding.ready.check.todo"
                    defaultMessage="(needs attention)"
                  />
                )}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {allOk ? (
        <p className="mt-3 text-sm text-muted-foreground">
          <FormattedMessage
            id="onboarding.ready.allOk"
            defaultMessage="Everything your install needs is in place."
          />
        </p>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          <FormattedMessage
            id="onboarding.ready.laterHint"
            defaultMessage="You can open your workspace now and finish these later."
          />
        </p>
      )}
    </section>
  )
}
