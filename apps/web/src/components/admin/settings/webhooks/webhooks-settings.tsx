'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { BoltIcon } from '@heroicons/react/24/outline'
import { EmptyState } from '@/components/shared/empty-state'
import { NewButton } from '@/components/shared/new-button'
import { StateBadge, type BadgeState } from '@/components/shared/state-badge'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { RowIcon, SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { UpgradeModal } from '@/components/admin/upgrade'
import { CreateWebhookDialog } from './create-webhook-dialog'
import { EditWebhookDialog } from './edit-webhook-dialog'
import { DeleteWebhookDialog } from './delete-webhook-dialog'
import type { Webhook } from '@/lib/shared/types'

const EVENT_LABELS: Record<string, string> = {
  'post.created': 'New post',
  'post.status_changed': 'Status changed',
  'comment.created': 'New comment',
  'changelog.published': 'Changelog published',
}

const WEBHOOK_LIMIT = 25

interface WebhooksSettingsProps {
  webhooks: Webhook[]
  entitled: boolean
}

export function WebhooksSettings({ webhooks, entitled }: WebhooksSettingsProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [editWebhook, setEditWebhook] = useState<Webhook | null>(null)
  const [deleteWebhook, setDeleteWebhook] = useState<Webhook | null>(null)

  const requestCreate = () => {
    if (!entitled) {
      setUpgradeOpen(true)
      return
    }
    setCreateDialogOpen(true)
  }

  /** The default (active, no failures) state shows no badge. */
  const getState = (webhook: Webhook): BadgeState | null => {
    if (webhook.status === 'disabled') return webhook.failureCount >= 50 ? 'error' : 'off'
    if (webhook.failureCount >= 25) return 'error'
    if (webhook.failureCount > 0) return 'attention'
    return null
  }

  /** Visible failure context, so it never hides in a tooltip. */
  const getFailureNote = (webhook: Webhook) => {
    if (webhook.status === 'disabled' && webhook.failureCount >= 50) {
      return `Auto-disabled after ${webhook.failureCount} failures`
    }
    if (webhook.failureCount > 0) {
      return `${webhook.failureCount} consecutive ${webhook.failureCount === 1 ? 'failure' : 'failures'}`
    }
    return null
  }

  const atLimit = webhooks.length >= WEBHOOK_LIMIT
  const newWebhookButton = (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      {atLimit && (
        <span className="text-[13px] text-muted-foreground">
          Limit of {WEBHOOK_LIMIT} webhooks reached
        </span>
      )}
      <NewButton noun="webhook" onClick={requestCreate} disabled={atLimit} />
    </div>
  )

  return (
    <>
      <SettingsCard
        title="Webhooks"
        description="Receive an HTTP POST when events happen in your workspace."
        action={newWebhookButton}
        flush
      >
        {webhooks.length === 0 ? (
          <EmptyState
            size="compact"
            icon={BoltIcon}
            title="No webhooks yet"
            description="Get notified when posts are created, statuses change or comments arrive."
          />
        ) : (
          <SettingsList>
            {webhooks.map((webhook) => (
              <SettingsListRow
                key={webhook.id}
                leading={<RowIcon icon={BoltIcon} />}
                title={webhook.url}
                badges={getState(webhook) && <StateBadge state={getState(webhook)!} />}
                meta={
                  <>
                    {getFailureNote(webhook) && (
                      <span className="text-destructive">{getFailureNote(webhook)}</span>
                    )}
                    {getFailureNote(webhook) && ' · '}
                    {webhook.lastError && webhook.failureCount > 0 ? (
                      <span className="text-destructive" title={webhook.lastError}>
                        Error: {webhook.lastError}
                      </span>
                    ) : (
                      <>
                        {webhook.events.map((e) => EVENT_LABELS[e] || e).join(', ')}
                        {webhook.lastTriggeredAt &&
                          ` · Last fired ${formatDistanceToNow(webhook.lastTriggeredAt, { addSuffix: true })}`}
                      </>
                    )}
                  </>
                }
                actions={[
                  { label: 'Edit', onSelect: () => setEditWebhook(webhook) },
                  { label: 'Delete', destructive: true, onSelect: () => setDeleteWebhook(webhook) },
                ]}
              />
            ))}
          </SettingsList>
        )}
      </SettingsCard>

      {/* Dialogs */}
      <CreateWebhookDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onPlanRefusal={() => {
          setCreateDialogOpen(false)
          setUpgradeOpen(true)
        }}
      />
      <UpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} entitlement="webhooks" />

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
    </>
  )
}
