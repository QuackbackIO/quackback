import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { FormattedMessage, useIntl } from 'react-intl'
import { GoalSelector } from '@/components/onboarding/goal-selector'
import {
  OnboardingHeading,
  OnboardingLead,
  OnboardingPreviewPanel,
  OnboardingSplit,
  SETUP_FIELD_CLASS,
  useBrowserHost,
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
  return <CloudWorkspaceDetailsStep identity={cloudIdentity} />
}

function CloudIdentityUnavailable() {
  return (
    <OnboardingSplit
      panel={<CloudPreviewPanel name="" hostname="" />}
      footer={<SignOutButton size="sm" className="-ms-3" />}
    >
      <OnboardingHeading className="text-[30px] leading-[1.12] tracking-[-0.02em] sm:text-[34px]">
        Workspace details are temporarily unavailable
      </OnboardingHeading>
      <OnboardingLead>
        Your workspace is ready, but its verified cloud identity has not arrived yet.
      </OnboardingLead>
      <Button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-8 h-12 w-full max-w-[440px] rounded-full text-base"
      >
        Retry
      </Button>
    </OnboardingSplit>
  )
}

/** The cloud form's panel: the portal at the name and address being typed. */
function CloudPreviewPanel({ name, hostname }: { name: string; hostname: string }) {
  const intl = useIntl()
  return (
    <OnboardingPreviewPanel
      caption={
        <FormattedMessage
          id="onboarding.workspace.previewCaption"
          defaultMessage="Your portal. It updates as you type and choose."
        />
      }
    >
      <PortalPreview
        name={
          name ||
          intl.formatMessage({
            id: 'onboarding.preview.placeholderName',
            defaultMessage: 'Your workspace',
          })
        }
        hostname={hostname}
      />
    </OnboardingPreviewPanel>
  )
}

export function CloudWorkspaceDetailsStep(props: { identity: CloudIdentity }) {
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

  return <CloudWorkspaceDetailsForm identity={props.identity} onSave={save} />
}

export function CloudWorkspaceDetailsForm(props: {
  identity: CloudIdentity
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
          className="h-12 w-full rounded-full text-base"
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
  const nameValid = workspaceName.trim().length >= 2

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
    try {
      // A config file owns managed goals: sending them would only be refused.
      const result = await saveWorkspaceAndGoalFn({
        data: goalsManaged
          ? { workspaceName: workspaceName.trim() }
          : { workspaceName: workspaceName.trim(), goals },
      })
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

  const previewName =
    (ready?.name ?? workspaceName.trim()) ||
    intl.formatMessage({
      id: 'onboarding.preview.placeholderName',
      defaultMessage: 'Your workspace',
    })
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
      <PortalPreview name={previewName} goals={ready?.goals ?? goals} hostname={host} />
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
      <form onSubmit={handleSubmit} className="mt-8 flex max-w-[480px] flex-col gap-8">
        <header>
          <OnboardingHeading>
            <FormattedMessage
              id="onboarding.workspace.heading"
              defaultMessage="Name your {br}workspace"
              values={{ br: <br /> }}
            />
          </OnboardingHeading>
          <OnboardingLead>
            <FormattedMessage
              id="onboarding.workspace.lead"
              defaultMessage="Your workspace is where your team works and what customers see on your portal. Most people use their company or product name."
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

        <div aria-live="polite" aria-atomic="true" className="empty:hidden">
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        <Button type="submit" disabled={isLoading} className="h-12 w-full rounded-full text-base">
          {isLoading ? (
            <>
              <ArrowPathIcon className="size-4 animate-spin motion-reduce:animate-none" />
              <FormattedMessage id="onboarding.workspace.creating" defaultMessage="Setting up…" />
            </>
          ) : (
            <FormattedMessage id="onboarding.workspace.create" defaultMessage="Create workspace" />
          )}
        </Button>
      </form>
    </OnboardingSplit>
  )
}
