import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { ExclamationTriangleIcon } from '@heroicons/react/24/solid'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { moduleCrumb } from '@/components/admin/settings/settings-nav-sections'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { TimeAgo } from '@/components/ui/time-ago'
import { GitHubConnectionActions } from '@/integrations/github/ui/github-connection-actions'
import { githubChannelStatusQuery } from '@/integrations/github/ui/github-channel-status-query'
import {
  useSetGitHubInbox,
  useSetGitHubRepositoryInbox,
} from '@/integrations/github/ui/use-github-inbox'
import type { GitHubChannelRepository } from '@/integrations/github/server/functions'

export function GitHubChannelPage() {
  const query = useQuery(githubChannelStatusQuery())
  const setInbox = useSetGitHubInbox()
  const intl = useIntl()
  const status = query.data
  const connected = !!status?.connected
  const repositories = status?.repositories ?? []
  const inboxEnabled = setInbox.isPending ? setInbox.variables : (status?.inboxEnabled ?? false)
  const attention =
    connected &&
    (!!status?.lastError ||
      status?.status !== 'active' ||
      (status?.inboxEnabled && !status?.hasToken))

  return (
    <SettingsPage
      page="/admin/settings/channels/github"
      description="Issues as conversations."
      crumbs={[
        moduleCrumb('/admin/settings/support'),
        { label: 'Channels', to: '/admin/settings/channels' },
      ]}
    >
      {attention && status?.lastError && (
        <div className="flex items-start gap-2 rounded-[10px] border border-destructive/30 bg-destructive/5 p-3">
          <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-destructive">
              Comments may not be reaching the inbox
            </p>
            <p className="mt-0.5 text-xs text-destructive/90">
              {status.lastError}{' '}
              <Link
                to="/admin/settings/integrations/$type"
                params={{ type: 'github' }}
                className="font-medium underline"
              >
                Manage integration
              </Link>
            </p>
          </div>
        </div>
      )}

      {!connected ? (
        <SettingsCard>
          <div className="flex flex-col items-start gap-4">
            <p className="text-sm">
              Connect a GitHub account to bring issues and comments into the inbox as conversations.
            </p>
            <GitHubConnectionActions
              isConnected={false}
              returnPath="/admin/settings/channels/github"
            />
            <p className="text-xs text-muted-foreground">
              One connection per workspace, shared with the Feedback tracker integration.
            </p>
          </div>
        </SettingsCard>
      ) : (
        <>
          <SettingsCard title="Connection">
            <SettingRows>
              <SettingRow
                label={status?.repo ?? 'No repository'}
                description={
                  status?.username
                    ? `Connected as @${status.username}, shared with the Feedback tracker`
                    : 'Shared with the Feedback tracker'
                }
                control={
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/admin/settings/integrations/$type" params={{ type: 'github' }}>
                      Manage integration
                      <ArrowTopRightOnSquareIcon className="size-3.5" />
                    </Link>
                  </Button>
                }
              />
            </SettingRows>
          </SettingsCard>

          <SettingsCard title="Inbox">
            <SettingRows>
              <SettingRow
                label="Open issues and comments in the inbox"
                description="New issues start conversations. Replies post as public comments on the issue."
                htmlFor="github-inbox"
                control={
                  <Switch
                    id="github-inbox"
                    checked={inboxEnabled}
                    disabled={query.isLoading}
                    onCheckedChange={(checked) => setInbox.mutate(checked)}
                  />
                }
              />
            </SettingRows>
          </SettingsCard>

          <SettingsCard
            title={intl.formatMessage({
              id: 'admin.githubChannel.repositoriesTitle',
              defaultMessage: 'Repositories',
            })}
            description={intl.formatMessage({
              id: 'admin.githubChannel.repositoriesDescription',
              defaultMessage: 'Choose which repositories bring their issues into the inbox.',
            })}
          >
            {repositories.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                <FormattedMessage
                  id="admin.githubChannel.noRepositories"
                  defaultMessage="No repositories yet. Add one in the GitHub integration."
                />
              </p>
            ) : (
              <SettingRows>
                {repositories.map((repository) => (
                  <RepositoryInboxRow
                    key={repository.id}
                    repository={repository}
                    inboxEnabled={inboxEnabled}
                  />
                ))}
              </SettingRows>
            )}
          </SettingsCard>

          <SettingsCard title="Sync">
            <SettingRows>
              <SettingRow
                label="Last sent"
                control={<SyncTime at={status?.lastOutboundAt} emptyLabel="No deliveries yet" />}
              />
              <SettingRow
                label="Last received"
                control={<SyncTime at={status?.lastInboundAt} emptyLabel="None received" />}
              />
            </SettingRows>
          </SettingsCard>
        </>
      )}
    </SettingsPage>
  )
}

/**
 * One repository's inbox switch. Notes why issues may still not arrive: the
 * repository is switched off or send-only, or its webhook does not deliver
 * comments yet.
 */
function RepositoryInboxRow({
  repository,
  inboxEnabled,
}: {
  repository: GitHubChannelRepository
  inboxEnabled: boolean
}) {
  const intl = useIntl()
  const setRepositoryInbox = useSetGitHubRepositoryInbox()
  const optedIn = setRepositoryInbox.isPending
    ? !!setRepositoryInbox.variables?.enabled
    : repository.inboundMode === 'conversations'
  const note = !repository.enabled
    ? intl.formatMessage({
        id: 'admin.githubChannel.repositoryPaused',
        defaultMessage: 'Sync is off for this repository.',
      })
    : !repository.receives
      ? intl.formatMessage({
          id: 'admin.githubChannel.repositorySendOnly',
          defaultMessage: 'This repository only sends, so nothing comes in from it.',
        })
      : optedIn && inboxEnabled && !repository.webhookEvents.includes('issue_comment')
        ? intl.formatMessage({
            id: 'admin.githubChannel.repositoryNoComments',
            defaultMessage:
              'Its webhook does not deliver comments yet. Repair it in the GitHub integration.',
          })
        : null
  return (
    <SettingRow
      label={repository.repo}
      htmlFor={`github-inbox-${repository.id}`}
      description={
        note ??
        (repository.lastInboundAt ? (
          <FormattedMessage
            id="admin.githubChannel.repositoryLastReceived"
            defaultMessage="Last received {time}"
            values={{ time: <TimeAgo date={repository.lastInboundAt} /> }}
          />
        ) : (
          intl.formatMessage({
            id: 'admin.githubChannel.repositoryNothingReceived',
            defaultMessage: 'Nothing received yet',
          })
        ))
      }
      control={
        <Switch
          id={`github-inbox-${repository.id}`}
          checked={optedIn}
          onCheckedChange={(enabled) =>
            setRepositoryInbox.mutate({ destinationId: repository.id, enabled })
          }
          aria-label={intl.formatMessage(
            {
              id: 'admin.githubChannel.repositoryInbox',
              defaultMessage: 'Bring issues from {repository} into the inbox',
            },
            { repository: repository.repo }
          )}
        />
      }
    />
  )
}

function SyncTime({ at, emptyLabel }: { at: string | null | undefined; emptyLabel: string }) {
  return (
    <span className="text-sm text-muted-foreground">{at ? <TimeAgo date={at} /> : emptyLabel}</span>
  )
}
