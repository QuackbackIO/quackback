import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { FormattedMessage, useIntl } from 'react-intl'
import { toast } from 'sonner'
import { GoalSelector } from '@/components/onboarding/goal-selector'
import {
  OnboardingHeading,
  OnboardingLead,
  OnboardingPreviewPanel,
  OnboardingSplit,
  SETUP_CTA_CLASS,
  SETUP_FIELD_CLASS,
  SetupActions,
  useBrowserHost,
  useSetupTitle,
} from '@/components/onboarding/onboarding-split'
import { PortalPreview } from '@/components/onboarding/portal-preview'
import { SetupSteps } from '@/components/onboarding/setup-steps'
import { getSetupState, type OnboardingOutcome } from '@/lib/shared/db-types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { saveWorkspaceAndGoalFn } from '@/lib/server/functions/onboarding'
import {
  getCloudIdentityFn,
  markCloudWorkspaceDetailsSeenFn,
  updateCloudIdentityFn,
} from '@/lib/server/functions/cloud-identity'
import { friendlyPlatformLabel, platformUrlSuffix } from '@/lib/shared/platform-label'
import { isPathManagedFromBootstrap, MANAGED_PATHS } from '@/lib/client/config-file'
import { track } from '@/lib/client/analytics'
import { cn } from '@/lib/shared/utils'
import { ReadyStep } from './-ready-step'
import { SignOutButton } from './-sign-out-button'

const DRAFT_KEY = 'quackback:onboarding:workspace-name'

type CloudIdentity = NonNullable<Awaited<ReturnType<typeof getCloudIdentityFn>>>

/** The goals already in setup state: a config file's, or an earlier save's. */
export interface WorkspaceSetupGoals {
  goals?: OnboardingOutcome[]
}

export interface WorkspaceStepProps {
  isCloudProvisioned: boolean
  cloudIdentity: CloudIdentity | null
  existingWorkspaceName: string
  managedFieldPaths: string[]
  setupGoals?: WorkspaceSetupGoals
  /** The signed-in admin's name, for the ready step. */
  adminName?: string | null
}

export function WorkspaceStep({
  isCloudProvisioned,
  cloudIdentity,
  existingWorkspaceName,
  managedFieldPaths,
  setupGoals,
  adminName,
}: WorkspaceStepProps) {
  if (!isCloudProvisioned) {
    return (
      <WorkspaceNameStep
        existingWorkspaceName={existingWorkspaceName}
        managedFieldPaths={managedFieldPaths}
        setupGoals={setupGoals}
        adminName={adminName}
      />
    )
  }
  if (!cloudIdentity) return <CloudIdentityUnavailable />
  return <CloudWorkspaceDetailsStep identity={cloudIdentity} goals={setupGoals?.goals} />
}

function CloudIdentityUnavailable() {
  return (
    <OnboardingSplit
      panel={<CloudPreviewPanel name="" hostname="" />}
      footer={<SignOutButton size="sm" className="-ms-3" />}
    >
      <OnboardingHeading className="text-[30px] leading-[1.12] tracking-[-0.02em]! sm:text-[34px]">
        Workspace details are temporarily unavailable
      </OnboardingHeading>
      <OnboardingLead>
        Your workspace is ready, but its verified cloud identity has not arrived yet.
      </OnboardingLead>
      <Button
        type="button"
        onClick={() => window.location.reload()}
        className={cn(SETUP_CTA_CLASS, 'mt-8 max-w-[440px]')}
      >
        Retry
      </Button>
    </OnboardingSplit>
  )
}

/** The cloud form's panel: the portal at the name and address being typed. */
function CloudPreviewPanel({
  name,
  hostname,
  goals,
}: {
  name: string
  hostname: string
  goals?: OnboardingOutcome[]
}) {
  return (
    <OnboardingPreviewPanel
      caption={
        <FormattedMessage
          id="onboarding.workspace.previewCaption"
          defaultMessage="Your portal. It updates as you type and choose."
        />
      }
    >
      <PortalPreview name={name} hostname={hostname} goals={goals?.length ? goals : undefined} />
    </OnboardingPreviewPanel>
  )
}

export function CloudWorkspaceDetailsStep(props: {
  identity: CloudIdentity
  goals?: OnboardingOutcome[]
}) {
  const navigate = useNavigate()

  async function continueToHome(transfer?: {
    token: string
    canonicalOrigin: string
  }): Promise<void> {
    await markCloudWorkspaceDetailsSeenFn()
    void track('onboarding_workspace_details_completed', { domainChanged: Boolean(transfer) })
    if (transfer) {
      const target = new URL('/auth/origin-transfer', transfer.canonicalOrigin)
      target.searchParams.set('ott', transfer.token)
      target.searchParams.set('returnTo', '/admin')
      window.location.assign(target)
      return
    }
    await navigate({ to: '/admin' })
  }

  async function save(input: { displayName: string; platformLabel: string }): Promise<void> {
    const result = await updateCloudIdentityFn({ data: input })
    await continueToHome(
      result.transferToken
        ? { token: result.transferToken, canonicalOrigin: result.projection.canonicalOrigin }
        : undefined
    )
  }

  return <CloudWorkspaceDetailsForm identity={props.identity} goals={props.goals} onSave={save} />
}

export function CloudWorkspaceDetailsForm(props: {
  identity: CloudIdentity
  goals?: OnboardingOutcome[]
  onSave: (input: { displayName: string; platformLabel: string }) => Promise<void>
}) {
  const [displayName, setDisplayName] = useState(props.identity.displayName)
  const [platformLabel, setPlatformLabel] = useState(
    friendlyPlatformLabel(props.identity.platformHostname)
  )
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const domainSuffix = platformUrlSuffix(props.identity)

  async function run(action: () => Promise<void>, fallback: string): Promise<void> {
    setIsSaving(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback)
      setIsSaving(false)
    }
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault()
    const name = displayName.trim()
    const friendlyLabel = platformLabel.trim()
    if (!name || !friendlyLabel) return
    void run(
      () => props.onSave({ displayName: name, platformLabel: friendlyLabel }),
      'Could not save workspace details. Try again.'
    )
  }

  return (
    <OnboardingSplit
      panel={
        <CloudPreviewPanel
          goals={props.goals}
          name={displayName.trim()}
          hostname={platformLabel.trim() ? `${platformLabel.trim()}.${domainSuffix}` : ''}
        />
      }
      footer={<SignOutButton size="sm" className="-ms-3" />}
    >
      <form
        onSubmit={submit}
        className="flex w-full max-w-[440px] flex-col gap-7 [--ring:var(--muted-foreground)]"
      >
        <header>
          <OnboardingHeading>
            Make this <br />
            workspace yours
          </OnboardingHeading>
          <OnboardingLead>
            Choose a name and the address customers will use. You can change these later in Admin
            Settings.
          </OnboardingLead>
        </header>

        <div className="space-y-2">
          <label htmlFor="cloud-workspace-name" className="text-sm font-medium">
            Workspace name
          </label>
          <Input
            id="cloud-workspace-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={80}
            disabled={isSaving}
            autoComplete="organization"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="cloud-platform-label" className="text-sm font-medium">
            Workspace URL
          </label>
          <div className="flex items-center rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring">
            <Input
              id="cloud-platform-label"
              value={platformLabel}
              onChange={(event) => setPlatformLabel(event.target.value)}
              className="border-0 focus-visible:ring-0"
              maxLength={63}
              autoCapitalize="none"
              autoCorrect="off"
              disabled={isSaving}
              placeholder="your-team"
              required
            />
            <span className="shrink-0 pe-3 text-sm text-muted-foreground">.{domainSuffix}</span>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={isSaving || !displayName.trim() || !platformLabel.trim()}
          aria-busy={isSaving || undefined}
          className={SETUP_CTA_CLASS}
        >
          {isSaving && (
            <ArrowPathIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          )}
          Continue
        </Button>
      </form>
    </OnboardingSplit>
  )
}

function WorkspaceNameStep({
  existingWorkspaceName,
  managedFieldPaths,
  setupGoals,
  adminName,
}: {
  existingWorkspaceName: string
  managedFieldPaths: string[]
  setupGoals?: WorkspaceSetupGoals
  adminName?: string | null
}) {
  const intl = useIntl()
  const navigate = useNavigate()
  const host = useBrowserHost()
  const goalsManaged = isPathManagedFromBootstrap('workspace.useCase', managedFieldPaths)
  // Nothing is picked for the admin: the first goal they choose is the one the
  // launch plan starts with, so a preselected goal would choose it for them.
  const [goals, setGoals] = useState<OnboardingOutcome[]>(setupGoals?.goals ?? [])
  const nameManaged = isPathManagedFromBootstrap(MANAGED_PATHS.WORKSPACE_NAME, managedFieldPaths)

  const [workspaceName, setWorkspaceName] = useState(existingWorkspaceName)
  const [isLoading, setIsLoading] = useState(false)
  /** What the server said, which is about the form rather than one field. */
  const [error, setError] = useState('')
  const [nameError, setNameError] = useState('')
  /** Set once the admin tries to continue, so an empty pick is then said. */
  const [goalsRequired, setGoalsRequired] = useState(false)
  const [ready, setReady] = useState<{ name: string; goals: OnboardingOutcome[] } | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const nameValid = workspaceName.trim().length >= 2
  useSetupTitle(
    ready
      ? intl.formatMessage(
          { id: 'onboarding.title.ready', defaultMessage: '{name} is ready · Quackback' },
          { name: ready.name }
        )
      : intl.formatMessage({
          id: 'onboarding.title.workspace',
          defaultMessage: 'Name your workspace · Quackback',
        })
  )

  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as {
        workspaceName?: string
        goals?: OnboardingOutcome[]
      } | null
      if (!goalsManaged && draft?.goals) {
        const normalized = getSetupState(JSON.stringify({ version: 2, goals: draft.goals }))
        if (normalized?.goals?.length) setGoals(normalized.goals)
      }
      if (!nameManaged && typeof draft?.workspaceName === 'string') {
        setWorkspaceName(draft.workspaceName)
      }
    } catch {
      localStorage.removeItem(DRAFT_KEY)
    }
  }, [nameManaged, goalsManaged])

  useEffect(() => {
    if (ready) return
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ workspaceName, goals }))
  }, [workspaceName, goals, ready])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const goalsMissing = !goalsManaged && goals.length === 0
    setGoalsRequired(goalsMissing)
    setNameError(
      nameValid
        ? ''
        : intl.formatMessage({
            id: 'onboarding.workspace.error.name',
            defaultMessage: 'Enter a workspace name with at least 2 characters.',
          })
    )
    if (!nameValid) {
      setError('')
      document.getElementById('workspaceName')?.focus()
      return
    }
    if (goalsMissing) {
      setError('')
      return
    }
    setIsLoading(true)
    setError('')
    setSignedOut(false)
    try {
      // A config file owns managed goals: sending them would only be refused.
      const result = await saveWorkspaceAndGoalFn({
        data: goalsManaged
          ? { workspaceName: workspaceName.trim() }
          : { workspaceName: workspaceName.trim(), goals },
      })
      if (!result.ok) {
        if (result.refusal === 'signed_out') {
          // The typed name stays in the draft, so it is still here after
          // signing back in.
          setSignedOut(true)
          return
        }
        if (result.refusal === 'not_owner') {
          await navigate({ to: '/onboarding/no-access' })
          return
        }
        // Setup is final: the name and goal are changed in Settings now.
        localStorage.removeItem(DRAFT_KEY)
        toast.info(
          intl.formatMessage({
            id: 'onboarding.workspace.alreadyFinished',
            defaultMessage: 'Setup is already finished.',
          })
        )
        await navigate({ to: '/admin' })
        return
      }
      void track('onboarding_workspace_saved', { enabledModules: result.enabledModules })
      localStorage.removeItem(DRAFT_KEY)
      setReady({ name: result.name ?? workspaceName.trim(), goals })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'onboarding.error.generic',
              defaultMessage: 'Something went wrong. Try again.',
            })
      )
    } finally {
      setIsLoading(false)
    }
  }

  const panel = (
    <OnboardingPreviewPanel
      caption={
        ready ? (
          <FormattedMessage
            id="onboarding.workspace.previewLive"
            defaultMessage="Your portal is live at {host}."
            values={{ host: <span className="font-mono text-[13px]">{host}</span> }}
          />
        ) : (
          <FormattedMessage
            id="onboarding.workspace.previewCaption"
            defaultMessage="Your portal. It updates as you type and choose."
          />
        )
      }
    >
      {ready ? (
        <PortalPreview variant="live" name={ready.name} goals={ready.goals} hostname={host} />
      ) : (
        <PortalPreview name={workspaceName.trim()} goals={goals} hostname={host} />
      )}
    </OnboardingPreviewPanel>
  )

  if (ready) {
    return (
      <OnboardingSplit panel={panel}>
        <ReadyStep workspaceName={ready.name} goals={ready.goals} adminName={adminName} />
      </OnboardingSplit>
    )
  }

  return (
    <OnboardingSplit panel={panel} footer={<SignOutButton size="sm" className="-ms-3" />}>
      <SetupSteps current="workspace" />
      {/* Budgeted to show Create workspace without scrolling on a 1280x800
          screen: a one-line heading and lead, and one-line goal tiles. */}
      <form onSubmit={handleSubmit} className="mt-6 flex max-w-[480px] flex-1 flex-col gap-6">
        <header>
          <OnboardingHeading className="text-[34px] leading-[1.05] sm:text-[36px]">
            <FormattedMessage
              id="onboarding.workspace.heading"
              defaultMessage="Name your workspace"
            />
          </OnboardingHeading>
          <OnboardingLead className="mt-3">
            <FormattedMessage
              id="onboarding.workspace.lead"
              defaultMessage="Most teams use their company or product name."
            />
          </OnboardingLead>
        </header>

        <div data-field className="flex flex-col gap-2">
          <label htmlFor="workspaceName" className="text-sm font-medium">
            <FormattedMessage id="onboarding.workspace.name" defaultMessage="Workspace name" />
          </label>
          <Input
            id="workspaceName"
            value={workspaceName}
            onChange={(event) => {
              setWorkspaceName(event.target.value)
              setNameError('')
            }}
            placeholder="Acme"
            autoFocus
            autoComplete="organization"
            disabled={isLoading || nameManaged}
            className={SETUP_FIELD_CLASS}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'workspace-name-error' : 'workspace-name-hint'}
          />
          {/* The problem takes the hint's place, so the field says one thing. */}
          {nameError ? (
            <p id="workspace-name-error" role="alert" className="text-xs text-destructive">
              {nameError}
            </p>
          ) : (
            <p id="workspace-name-hint" className="text-xs text-muted-foreground">
              {nameManaged ? (
                <FormattedMessage
                  id="onboarding.workspace.nameManaged"
                  defaultMessage="Your workspace admin manages this name."
                />
              ) : (
                <FormattedMessage
                  id="onboarding.workspace.nameHint"
                  defaultMessage="You can change it any time in Settings."
                />
              )}
            </p>
          )}
        </div>

        <GoalSelector
          goals={goals}
          onGoalsChange={setGoals}
          disabled={isLoading}
          managed={goalsManaged}
          required={goalsRequired}
        />

        <SetupActions>
          {/* Inside the pinned bar, so a refusal is never below the fold or under it. */}
          <div aria-live="polite" aria-atomic="true" className="mb-3 empty:hidden">
            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            {signedOut && (
              <div
                role="alert"
                className="flex flex-col items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-center text-sm sm:flex-row sm:justify-between sm:text-start"
              >
                <span>
                  <FormattedMessage
                    id="onboarding.workspace.signedOut"
                    defaultMessage="You were signed out. Sign in to finish setting up."
                  />
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void navigate({ to: '/onboarding/account' })}
                >
                  <FormattedMessage id="onboarding.workspace.signIn" defaultMessage="Sign in" />
                </Button>
              </div>
            )}
          </div>
          <Button
            type="submit"
            disabled={isLoading}
            aria-busy={isLoading || undefined}
            className={SETUP_CTA_CLASS}
          >
            {isLoading ? (
              <>
                <ArrowPathIcon className="size-4 animate-spin motion-reduce:animate-none" />
                <FormattedMessage id="onboarding.workspace.creating" defaultMessage="Setting up…" />
              </>
            ) : (
              <FormattedMessage
                id="onboarding.workspace.create"
                defaultMessage="Create workspace"
              />
            )}
          </Button>
        </SetupActions>
      </form>
    </OnboardingSplit>
  )
}
