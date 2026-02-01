'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { PlusIcon, BoltIcon, TrashIcon, PencilIcon } from '@heroicons/react/24/outline'
import { EllipsisVerticalIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CreateWebhookDialog } from './create-webhook-dialog'
import { EditWebhookDialog } from './edit-webhook-dialog'
import { DeleteWebhookDialog } from './delete-webhook-dialog'
import type { Webhook } from '@/lib/server/domains/webhooks'

const EVENT_LABELS: Record<string, string> = {
  'post.created': 'New Post',
  'post.status_changed': 'Status Changed',
  'post.vote_threshold': 'Vote Milestone',
  'comment.created': 'New Comment',
}

interface WebhooksSettingsProps {
  webhooks: Webhook[]
}

export function WebhooksSettings({ webhooks }: WebhooksSettingsProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editWebhook, setEditWebhook] = useState<Webhook | null>(null)
  const [deleteWebhook, setDeleteWebhook] = useState<Webhook | null>(null)

  const getStatusBadge = (webhook: Webhook) => {
    if (webhook.status === 'disabled') {
      if (webhook.failureCount >= 50) {
        return (
          <Badge
            variant="destructive"
            title={`Auto-disabled after ${webhook.failureCount} failures`}
          >
            Auto-disabled
          </Badge>
        )
      }
      return <Badge variant="secondary">Disabled</Badge>
    }
    if (webhook.failureCount >= 25) {
      return (
        <Badge variant="destructive" title={`${webhook.failureCount} consecutive failures`}>
          Failing ({webhook.failureCount}/50)
        </Badge>
      )
    }
    if (webhook.failureCount > 0) {
      return (
        <Badge variant="outline" title={`${webhook.failureCount} consecutive failures`}>
          Issues ({webhook.failureCount})
        </Badge>
      )
    }
    return <Badge variant="default">Active</Badge>
  }

  return (
    <div className="space-y-4">
      {/* Empty state */}
      {webhooks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center rounded-lg border border-dashed">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
            <BoltIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium mb-1">No webhooks configured</h3>
          <p className="text-sm text-muted-foreground max-w-sm mb-4">
            Get notified in real-time when posts are created, statuses change, or votes hit
            milestones. Connect to Slack, Discord, or your own systems.
          </p>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <PlusIcon className="h-4 w-4 mr-1.5" />
            Create your first webhook
          </Button>
        </div>
      )}

      {/* Header with create button */}
      {webhooks.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{webhooks.length} of 25 webhooks</p>
          <Button
            size="sm"
            onClick={() => setCreateDialogOpen(true)}
            disabled={webhooks.length >= 25}
          >
            <PlusIcon className="h-4 w-4 mr-1.5" />
            Create Webhook
          </Button>
        </div>
      )}

      {/* Webhooks list */}
      {webhooks.length > 0 && (
        <div className="space-y-3">
          {webhooks.map((webhook) => (
            <div
              key={webhook.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-border/50 p-4"
            >
              <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <BoltIcon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className="text-sm font-medium truncate max-w-[200px] sm:max-w-[300px]"
                      title={webhook.url}
                    >
                      {webhook.url}
                    </p>
                    {getStatusBadge(webhook)}
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-xs text-muted-foreground mt-1">
                    <span className="truncate">
                      {webhook.events.map((e) => EVENT_LABELS[e] || e).join(', ')}
                    </span>
                    {webhook.lastTriggeredAt && (
                      <>
                        <span className="hidden sm:inline">·</span>
                        <span>
                          Last fired{' '}
                          {formatDistanceToNow(webhook.lastTriggeredAt, { addSuffix: true })}
                        </span>
                      </>
                    )}
                  </div>
                  {webhook.lastError && webhook.failureCount > 0 && (
                    <p className="text-xs text-destructive mt-1 truncate" title={webhook.lastError}>
                      Error: {webhook.lastError}
                    </p>
                  )}
                </div>
              </div>

              {/* Desktop: show buttons */}
              <div className="hidden sm:flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditWebhook(webhook)}
                  aria-label={`Edit webhook ${webhook.url}`}
                >
                  <PencilIcon className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteWebhook(webhook)}
                  aria-label={`Delete webhook ${webhook.url}`}
                  className="text-destructive hover:text-destructive"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>

              {/* Mobile: dropdown menu */}
              <div className="sm:hidden self-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" aria-label="Webhook actions">
                      <EllipsisVerticalIcon className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditWebhook(webhook)}>
                      <PencilIcon className="h-4 w-4 mr-2" />
                      Edit Webhook
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setDeleteWebhook(webhook)}
                      className="text-destructive focus:text-destructive"
                    >
                      <TrashIcon className="h-4 w-4 mr-2" />
                      Delete Webhook
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialogs */}
      <CreateWebhookDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />

      {editWebhook && (
        <EditWebhookDialog
          webhook={editWebhook}
          open={!!editWebhook}
          onOpenChange={(open) => !open && setEditWebhook(null)}
        />
      )}

      {deleteWebhook && (
        <DeleteWebhookDialog
          webhook={deleteWebhook}
          open={!!deleteWebhook}
          onOpenChange={(open) => !open && setDeleteWebhook(null)}
        />
      )}
    </div>
  )
}
