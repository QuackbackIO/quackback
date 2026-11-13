'use client'

/**
 * The selected repository's webhook health, under the repository picker:
 * whether its webhook is registered, when it last delivered, the error its
 * last registration hit, and a repair that registers the webhook again.
 */
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { toast } from 'sonner'
import { ArrowPathIcon, FolderIcon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TimeAgo } from '@/components/ui/time-ago'
import { adminQueries } from '@/lib/client/queries/admin'
import { useReconnectIntegrationDestination } from '@/lib/client/mutations'

interface GitHubRepositoryCardProps {
  /** The selected repository (`owner/repo`). */
  repository: string
}

export function GitHubRepositoryCard({ repository }: GitHubRepositoryCardProps) {
  const intl = useIntl()
  const destinationsQuery = useQuery(adminQueries.integrationDestinations('github'))
  const repair = useReconnectIntegrationDestination()

  const wanted = repository.toLowerCase()
  const destination = destinationsQuery.data?.find(
    (d) => d.kind === 'repo' && d.externalId.toLowerCase() === wanted
  )
  if (!destination) return null

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

  return (
    <div className="rounded-lg border border-border/60 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{destination.externalId}</span>
          <Badge size="sm" variant={badge.variant}>
            {badge.label}
          </Badge>
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
    </div>
  )
}
