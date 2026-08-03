import { useEffect, useState } from 'react'
import { createFileRoute, useSearch } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { PlatformCredentialsDialog } from '@/components/admin/settings/integrations/platform-credentials-dialog'
import { GitHubConnectionCard } from '@/components/admin/settings/integrations/github/github-connection-card'
import { GitHubAddRepoDialog } from '@/components/admin/settings/integrations/github/github-add-repo-dialog'
import { Button } from '@/components/ui/button'
import { CheckCircleIcon, ExclamationTriangleIcon, PlusIcon } from '@heroicons/react/24/solid'
import { GitHubIcon } from '@/components/icons/integration-icons'
import { githubCatalog } from '@/lib/shared/integration-catalog'

export const Route = createFileRoute('/admin/settings/integrations/github')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.githubIntegrations())
    return {}
  },
  component: GitHubIntegrationPage,
})

function formatGitHubOAuthError(reason: string | undefined): string {
  switch (reason) {
    case 'credentials_not_configured':
      return 'GitHub credentials are not configured.'
    case 'github_denied':
      return 'GitHub authorization was cancelled.'
    case 'state_expired':
      return 'GitHub authorization expired. Start reconnect again.'
    case 'state_mismatch':
    case 'invalid_state':
      return 'GitHub authorization could not be verified. Start reconnect again.'
    case 'auth_required':
    case 'session_mismatch':
      return 'Sign in with the same admin account that started the GitHub reconnect.'
    case 'exchange_failed':
      return 'GitHub authorization failed while saving the refreshed connection.'
    default:
      return 'GitHub authorization failed.'
  }
}

function GitHubIntegrationPage() {
  const githubQuery = useSuspenseQuery(adminQueries.githubIntegrations())
  const { connections, platformCredentialFields, platformCredentialsConfigured } = githubQuery.data
  const queryClient = useQueryClient()
  const search = useSearch({ strict: false })
  const [credentialsOpen, setCredentialsOpen] = useState(false)
  const [addRepoOpen, setAddRepoOpen] = useState(false)
  const [oauthNotice, setOauthNotice] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)

  const hasConnections = connections.length > 0
  const anyActive = connections.some((c) => c.status === 'active')

  useEffect(() => {
    const searchParams = search as Record<string, string | undefined>
    const status = searchParams.github
    if (status !== 'connected' && status !== 'error') return

    queryClient.invalidateQueries({ queryKey: adminQueries.githubIntegrations().queryKey })
    queryClient.invalidateQueries({ queryKey: adminQueries.integrations().queryKey })

    setOauthNotice(
      status === 'connected'
        ? { type: 'success', message: 'GitHub connection refreshed.' }
        : { type: 'error', message: formatGitHubOAuthError(searchParams.reason) }
    )

    const url = new URL(window.location.href)
    url.searchParams.delete('github')
    url.searchParams.delete('reason')
    window.history.replaceState({}, '', url.toString())

    if (status === 'connected') {
      const timer = setTimeout(() => setOauthNotice(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [queryClient, search])

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={githubCatalog}
        status={anyActive ? 'active' : hasConnections ? 'paused' : null}
        icon={<GitHubIcon className="h-6 w-6 text-white" />}
        actions={
          hasConnections ? (
            <div className="flex items-center gap-2">
              {platformCredentialFields.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                  Configure credentials
                </Button>
              )}
              {platformCredentialsConfigured && (
                <Button size="sm" onClick={() => setAddRepoOpen(true)}>
                  <PlusIcon className="mr-1.5 h-4 w-4" />
                  Add repository
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      {oauthNotice && (
        <div
          className={
            oauthNotice.type === 'success'
              ? 'flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300'
              : 'flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300'
          }
        >
          {oauthNotice.type === 'success' ? (
            <CheckCircleIcon className="h-4 w-4" />
          ) : (
            <ExclamationTriangleIcon className="h-4 w-4" />
          )}
          <span>{oauthNotice.message}</span>
        </div>
      )}

      {hasConnections && (
        <div className="space-y-4">
          {connections.map((connection) => (
            <GitHubConnectionCard key={connection.id} connection={connection} />
          ))}
        </div>
      )}

      {!hasConnections && (
        <IntegrationSetupCard
          icon={<GitHubIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect your GitHub repositories"
          description="Connect GitHub to sync tickets with issues bidirectionally. You can add multiple repositories, each with its own sync settings."
          steps={[
            <p key="1">
              Click <span className="font-medium text-foreground">Add repository</span> to authorize
              Quackback and select a repository.
            </p>,
            <p key="2">Configure sync direction, status mappings, and which events to sync.</p>,
            <p key="3">Add more repositories at any time — each with independent settings.</p>,
          ]}
          connectionForm={
            <div className="flex flex-col items-end gap-2">
              {platformCredentialFields.length > 0 && !platformCredentialsConfigured && (
                <Button onClick={() => setCredentialsOpen(true)}>Configure credentials</Button>
              )}
              {platformCredentialsConfigured && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setCredentialsOpen(true)}>
                    Configure credentials
                  </Button>
                  <Button onClick={() => setAddRepoOpen(true)}>
                    <PlusIcon className="mr-1.5 h-4 w-4" />
                    Add repository
                  </Button>
                </div>
              )}
            </div>
          }
        />
      )}

      {platformCredentialFields.length > 0 && (
        <PlatformCredentialsDialog
          integrationType="github"
          integrationName="GitHub"
          fields={platformCredentialFields}
          open={credentialsOpen}
          onOpenChange={setCredentialsOpen}
        />
      )}

      <GitHubAddRepoDialog open={addRepoOpen} onOpenChange={setAddRepoOpen} />
    </div>
  )
}
