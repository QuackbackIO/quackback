'use client'

/**
 * One synced repository in the GitHub settings list: its state, whether its
 * webhook is registered, when it last delivered and the error its last
 * registration hit, with a repair that registers the webhook again. Below
 * that, its own switches: on or off (off keeps the webhook, so switching back
 * is immediate), whether its issues come into the inbox (as conversations,
 * or as tickets with their team and type), whether an issue's assignee
 * follows onto its tickets (not for a send-only repository), whether a
 * linked ticket's public replies are posted to its issues as comments (with a
 * warning that they become visible there; not for a receive-only one),
 * whether each new ticket it matches gets an issue there (not for a
 * receive-only one), which way it syncs, and removing it. A repository set to
 * bring issues in while the GitHub inbox channel is off says so, with a link
 * to the channel.
 */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { toast } from 'sonner'
import { ArrowPathIcon, FolderIcon, TrashIcon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TimeAgo } from '@/components/ui/time-ago'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { GitHubInboundModeControl } from '@/integrations/github/ui/github-inbound-mode'
import { GitHubTicketIssues } from '@/integrations/github/ui/github-ticket-issues'
import {
  useReconnectIntegrationDestination,
  useRemoveIntegrationDestination,
  useSetIntegrationDestinationConfig,
  useSetIntegrationDestinationEnabled,
} from '@/lib/client/mutations'
import type { IntegrationDestinationSummary } from '@/lib/server/functions/integration-destinations'

interface GitHubRepositoryCardProps {
  destination: IntegrationDestinationSummary
  /** The GitHub inbox channel is off: nothing a repository brings in arrives. */
  inboxOff?: boolean
}

export function GitHubRepositoryCard({ destination, inboxOff }: GitHubRepositoryCardProps) {
  const intl = useIntl()
  const repair = useReconnectIntegrationDestination()
  const remove = useRemoveIntegrationDestination()
  const setEnabled = useSetIntegrationDestinationEnabled()
  const setConfig = useSetIntegrationDestinationConfig()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const saveFailed = () =>
    toast.error(
      intl.formatMessage({
        id: 'admin.githubRepository.saveFailed',
        defaultMessage: 'Could not save the repository settings',
      })
    )

  const badge = destination.lastError
    ? {
        variant: 'destructive' as const,
        label: intl.formatMessage({ id: 'admin.githubRepository.error', defaultMessage: 'Error' }),
      }
    : destination.enabled
      ? {
          variant: 'success' as const,
          label: intl.formatMessage({
            id: 'admin.githubRepository.active',
            defaultMessage: 'Active',
          }),
        }
      : {
          variant: 'secondary' as const,
          label: intl.formatMessage({
            id: 'admin.githubRepository.paused',
            defaultMessage: 'Paused',
          }),
        }

  const handleRepair = () =>
    repair.mutate(destination.id, {
      onSuccess: () =>
        toast.success(
          intl.formatMessage({
            id: 'admin.githubRepository.repaired',
            defaultMessage: 'Webhook repaired',
          })
        ),
      onError: () =>
        toast.error(
          intl.formatMessage({
            id: 'admin.githubRepository.repairFailed',
            defaultMessage: 'Could not repair the webhook',
          })
        ),
    })

  const handleRemove = async () => {
    try {
      await remove.mutateAsync(destination.id)
      setConfirmRemove(false)
    } catch {
      toast.error(
        intl.formatMessage({
          id: 'admin.githubRepository.removeFailed',
          defaultMessage: 'Could not remove the repository',
        })
      )
    }
  }

  const directionLabel = (direction: IntegrationDestinationSummary['direction']) =>
    direction === 'outbound'
      ? intl.formatMessage({
          id: 'admin.githubRepository.direction.outbound',
          defaultMessage: 'Send only',
        })
      : direction === 'inbound'
        ? intl.formatMessage({
            id: 'admin.githubRepository.direction.inbound',
            defaultMessage: 'Receive only',
          })
        : intl.formatMessage({
            id: 'admin.githubRepository.direction.both',
            defaultMessage: 'Send and receive',
          })

  return (
    <div className="rounded-lg border border-border/60 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{destination.externalId}</span>
          <Badge size="sm" variant={badge.variant}>
            {badge.label}
          </Badge>
          {destination.isDefault && (
            <Badge size="sm" variant="outline">
              <FormattedMessage id="admin.githubRepository.default" defaultMessage="Default" />
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRepair}
          disabled={repair.isPending}
          className="h-8 shrink-0 gap-1.5 text-xs"
        >
          <ArrowPathIcon className={`h-3.5 w-3.5 ${repair.isPending ? 'animate-spin' : ''}`} />
          <FormattedMessage id="admin.githubRepository.repair" defaultMessage="Repair webhook" />
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {destination.webhookRegistered ? (
            <FormattedMessage
              id="admin.githubRepository.webhookRegistered"
              defaultMessage="Webhook registered"
            />
          ) : (
            <FormattedMessage id="admin.githubRepository.noWebhook" defaultMessage="No webhook" />
          )}
        </span>
        <span>
          {destination.lastInboundAt ? (
            <FormattedMessage
              id="admin.githubRepository.lastDelivery"
              defaultMessage="Last delivery received {time}"
              values={{ time: <TimeAgo date={destination.lastInboundAt} /> }}
            />
          ) : (
            <FormattedMessage
              id="admin.githubRepository.noDeliveries"
              defaultMessage="No deliveries received yet"
            />
          )}
        </span>
      </div>
      {destination.lastError && (
        <p className="mt-2 break-words text-xs text-destructive">{destination.lastError}</p>
      )}
      {inboxOff && destination.inboundMode !== 'off' && (
        <p className="mt-2 text-xs text-muted-foreground">
          <FormattedMessage
            id="admin.githubRepository.inboxChannelOff"
            defaultMessage="The GitHub inbox channel is off, so new issues are not brought in. <link>Turn it on</link>"
            values={{
              link: (chunks) => (
                <Link to="/admin/settings/channels/github" className="font-medium underline">
                  {chunks}
                </Link>
              ),
            }}
          />
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border/50 pt-3">
        <div className="flex items-center gap-2 text-xs">
          <Switch
            checked={destination.enabled}
            disabled={setEnabled.isPending}
            onCheckedChange={(enabled) =>
              setEnabled.mutate({ destinationId: destination.id, enabled }, { onError: saveFailed })
            }
            aria-label={intl.formatMessage(
              { id: 'admin.githubRepository.enable', defaultMessage: 'Sync {repository}' },
              { repository: destination.externalId }
            )}
          />
          <span aria-hidden>
            <FormattedMessage id="admin.githubRepository.enabled" defaultMessage="Sync on" />
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span aria-hidden>
            <FormattedMessage id="admin.githubRepository.inbox" defaultMessage="Inbox" />
          </span>
          <GitHubInboundModeControl
            repository={destination.externalId}
            inboundMode={destination.inboundMode}
            ticketScope={destination.ticketScope}
            disabled={setConfig.isPending}
            onChange={(config) =>
              setConfig.mutate(
                { destinationId: destination.id, config: { ...config } },
                { onError: saveFailed }
              )
            }
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Switch
            checked={destination.assigneeSync}
            disabled={setConfig.isPending || destination.direction === 'outbound'}
            onCheckedChange={(assigneeSync) =>
              setConfig.mutate(
                { destinationId: destination.id, config: { assigneeSync } },
                { onError: saveFailed }
              )
            }
            aria-label={intl.formatMessage(
              {
                id: 'admin.githubRepository.assigneeSync',
                defaultMessage: 'Follow issue assignees from {repository} onto tickets',
              },
              { repository: destination.externalId }
            )}
          />
          <span aria-hidden>
            <FormattedMessage
              id="admin.githubRepository.assigneeSyncLabel"
              defaultMessage="Assignees"
            />
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Switch
            checked={destination.postRepliesAsComments}
            disabled={setConfig.isPending || destination.direction === 'inbound'}
            onCheckedChange={(postRepliesAsComments) =>
              setConfig.mutate(
                { destinationId: destination.id, config: { postRepliesAsComments } },
                { onError: saveFailed }
              )
            }
            aria-label={intl.formatMessage(
              {
                id: 'admin.githubRepository.postReplies',
                defaultMessage: 'Post ticket replies as comments on linked issues in {repository}',
              },
              { repository: destination.externalId }
            )}
          />
          <span aria-hidden>
            <FormattedMessage
              id="admin.githubRepository.postRepliesLabel"
              defaultMessage="Replies as comments"
            />
          </span>
        </div>
        <GitHubTicketIssues
          destinationId={destination.id}
          repository={destination.externalId}
          settings={destination.ticketIssues}
          disabled={destination.direction === 'inbound'}
        />
        <Select
          value={destination.direction}
          disabled={setConfig.isPending}
          onValueChange={(direction) =>
            setConfig.mutate(
              { destinationId: destination.id, config: { direction } },
              { onError: saveFailed }
            )
          }
        >
          <SelectTrigger
            className="h-8 w-44 text-xs"
            aria-label={intl.formatMessage({
              id: 'admin.githubRepository.direction',
              defaultMessage: 'Sync direction',
            })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['both', 'outbound', 'inbound'] as const).map((direction) => (
              <SelectItem key={direction} value={direction}>
                {directionLabel(direction)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmRemove(true)}
          className="ml-auto h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
        >
          <TrashIcon className="h-3.5 w-3.5" />
          <FormattedMessage id="admin.githubRepository.remove" defaultMessage="Remove" />
        </Button>
      </div>
      {destination.postRepliesAsComments && (
        <p className="mt-2 text-xs text-muted-foreground">
          <FormattedMessage
            id="admin.githubRepository.postRepliesWarning"
            defaultMessage="Public replies on linked tickets, including the customer's, are posted to the issue and visible to anyone who can see it."
          />
        </p>
      )}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        variant="destructive"
        title={intl.formatMessage(
          {
            id: 'admin.githubRepository.removeTitle',
            defaultMessage: 'Stop syncing {repository}?',
          },
          { repository: destination.externalId }
        )}
        description={intl.formatMessage({
          id: 'admin.githubRepository.removeDescription',
          defaultMessage:
            'Its webhook is removed and every ticket and post linked to its issues is unlinked. The issues stay on GitHub.',
        })}
        confirmLabel={intl.formatMessage({
          id: 'admin.githubRepository.removeConfirm',
          defaultMessage: 'Remove repository',
        })}
        cancelLabel={intl.formatMessage({
          id: 'admin.githubRepository.cancel',
          defaultMessage: 'Cancel',
        })}
        isPending={remove.isPending}
        onConfirm={handleRemove}
      />
    </div>
  )
}
