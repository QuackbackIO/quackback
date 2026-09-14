import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { FormattedMessage, useIntl } from 'react-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { saveWorkspaceAndGoalFn } from '@/lib/server/functions/onboarding'
import {
  getCloudIdentityFn,
  markCloudWorkspaceDetailsSeenFn,
  updateCloudIdentityFn,
} from '@/lib/server/functions/cloud-identity'
import { friendlyPlatformLabel, platformUrlSuffix } from '@/lib/shared/platform-label'
import { toastEnabledModules } from '@/lib/client/enabled-modules-toast'
import { isPathManagedFromBootstrap, MANAGED_PATHS } from '@/lib/client/config-file'

const DRAFT_KEY = 'quackback:onboarding:workspace-name'

type CloudIdentity = NonNullable<Awaited<ReturnType<typeof getCloudIdentityFn>>>

export interface WorkspaceStepProps {
  isCloudProvisioned: boolean
  cloudIdentity: CloudIdentity | null
  existingWorkspaceName: string
  managedFieldPaths: string[]
}

export function WorkspaceStep({
  isCloudProvisioned,
  cloudIdentity,
  existingWorkspaceName,
  managedFieldPaths,
}: WorkspaceStepProps) {
  if (!isCloudProvisioned) {
    return (
      <WorkspaceNameStep
        existingWorkspaceName={existingWorkspaceName}
        managedFieldPaths={managedFieldPaths}
      />
    )
  }
  if (!cloudIdentity) return <CloudIdentityUnavailable />
  return <CloudWorkspaceDetailsStep identity={cloudIdentity} />
}

function CloudIdentityUnavailable() {
  return (
    <div className="mx-auto max-w-lg space-y-5 text-center">
      <h1 className="text-2xl font-bold">Workspace details are temporarily unavailable</h1>
      <p className="text-sm text-muted-foreground">
        Your workspace is ready, but its verified cloud identity has not arrived yet.
      </p>
      <Button type="button" onClick={() => window.location.reload()}>
        Retry
      </Button>
    </div>
  )
}

export function CloudWorkspaceDetailsStep(props: { identity: CloudIdentity }) {
  const navigate = useNavigate()

  async function continueToHome(transfer?: {
    token: string
    canonicalOrigin: string
  }): Promise<void> {
    await markCloudWorkspaceDetailsSeenFn()
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
    <form onSubmit={submit} className="mx-auto flex w-full max-w-xl flex-col gap-7 pb-24 sm:pb-0">
      <header className="text-center">
        <h1 className="text-2xl font-bold">Make this workspace yours</h1>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
          Choose a name and the address customers will use. You can change these later in Admin
          Settings.
        </p>
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

      <div className="flex flex-col items-center gap-2">
        <Button
          type="submit"
          disabled={isSaving || !displayName.trim() || !platformLabel.trim()}
          className="h-11 w-full max-w-sm"
        >
          {isSaving && (
            <ArrowPathIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          )}
          Continue
        </Button>
      </div>
    </form>
  )
}

function WorkspaceNameStep({
  existingWorkspaceName,
  managedFieldPaths,
}: {
  existingWorkspaceName: string
  managedFieldPaths: string[]
}) {
  const intl = useIntl()
  const navigate = useNavigate()
  const nameManaged = isPathManagedFromBootstrap(MANAGED_PATHS.WORKSPACE_NAME, managedFieldPaths)

  const [workspaceName, setWorkspaceName] = useState(existingWorkspaceName)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const nameValid = workspaceName.trim().length >= 2

  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as {
        workspaceName?: string
      } | null
      if (!nameManaged && typeof draft?.workspaceName === 'string') {
        setWorkspaceName(draft.workspaceName)
      }
    } catch {
      localStorage.removeItem(DRAFT_KEY)
    }
  }, [nameManaged])

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ workspaceName }))
  }, [workspaceName])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!nameValid) {
      setError(
        intl.formatMessage({
          id: 'onboarding.workspace.error.name',
          defaultMessage: 'Enter a workspace name with at least 2 characters.',
        })
      )
      return
    }
    setIsLoading(true)
    setError('')
    try {
      const result = await saveWorkspaceAndGoalFn({
        data: { workspaceName: workspaceName.trim() },
      })
      toastEnabledModules(result.enabledModules)
      localStorage.removeItem(DRAFT_KEY)
      await navigate({ to: '/admin' })
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

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto flex w-full max-w-2xl flex-col gap-8 pb-24 sm:pb-0"
    >
      <header className="text-center">
        <h1 className="text-2xl font-bold">
          <FormattedMessage
            id="onboarding.workspace.title"
            defaultMessage="Create your workspace"
          />
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          <FormattedMessage
            id="onboarding.workspace.description"
            defaultMessage="Give your team a home in Quackback."
          />
        </p>
      </header>

      <div className="space-y-3">
        <label htmlFor="workspaceName" className="text-sm font-medium">
          <FormattedMessage id="onboarding.workspace.name" defaultMessage="Workspace name" />
        </label>
        <Input
          id="workspaceName"
          value={workspaceName}
          onChange={(event) => setWorkspaceName(event.target.value)}
          placeholder="Acme"
          autoFocus
          autoComplete="organization"
          disabled={isLoading || nameManaged}
          className="h-11"
          aria-describedby={nameManaged ? 'workspace-name-hint' : undefined}
        />
        {nameManaged ? (
          <p id="workspace-name-hint" className="text-xs text-muted-foreground">
            <FormattedMessage
              id="onboarding.workspace.nameManaged"
              defaultMessage="Your workspace admin manages this name."
            />
          </p>
        ) : null}
      </div>

      <div aria-live="polite" aria-atomic="true">
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-4 sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <Button
          type="submit"
          disabled={isLoading || !nameValid}
          className="mx-auto h-11 w-full max-w-sm"
        >
          {isLoading ? (
            <>
              <ArrowPathIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              <FormattedMessage id="onboarding.workspace.saving" defaultMessage="Saving…" />
            </>
          ) : (
            <FormattedMessage id="onboarding.workspace.open" defaultMessage="Open workspace" />
          )}
        </Button>
      </div>
    </form>
  )
}
