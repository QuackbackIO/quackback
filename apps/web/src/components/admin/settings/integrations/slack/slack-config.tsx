import { useState, useRef, useMemo } from 'react'
import {
  ArrowPathIcon,
  HashtagIcon,
  LockClosedIcon,
  XMarkIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  ChevronUpDownIcon,
} from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  useUpdateIntegration,
  useAddMonitoredChannel,
  useUpdateMonitoredChannel,
  useRemoveMonitoredChannel,
} from '@/lib/client/mutations'
import { adminQueries } from '@/lib/client/queries/admin'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSlackChannelsFn, type SlackChannel } from '@/lib/server/integrations/slack/functions'
import {
  NotificationChannelRouter,
  type NotificationChannel,
} from '@/components/admin/settings/integrations/shared/notification-channel-router'

// ============================================
// Types
// ============================================

interface MonitoredChannel {
  channelId: string
  channelName: string
  boardId: string | null
  enabled: boolean
}

interface SlackConfigProps {
  integrationId: string
  initialConfig: { channelId?: string; scopes?: string }
  initialEventMappings: { id: string; eventType: string; enabled: boolean }[]
  notificationChannels?: NotificationChannel[]
  monitoredChannels?: MonitoredChannel[]
  enabled: boolean
}

// ============================================
// Constants
// ============================================

const SLACK_EVENT_CONFIG = [
  {
    id: 'post.created' as const,
    label: 'New feedback submitted',
    shortLabel: 'Feedback',
    description: 'When a user submits new feedback',
  },
  {
    id: 'post.status_changed' as const,
    label: 'Feedback status changed',
    shortLabel: 'Status',
    description: 'When the status of a feedback post is updated',
  },
  {
    id: 'comment.created' as const,
    label: 'New comment on feedback',
    shortLabel: 'Comment',
    description: 'When someone comments on a feedback post',
  },
  {
    id: 'changelog.published' as const,
    label: 'Changelog published',
    shortLabel: 'Changelog',
    description: 'When a changelog entry is published',
  },
]

// ============================================
// Helpers
// ============================================

function ChannelIcon({ isPrivate }: { isPrivate: boolean }) {
  const Icon = isPrivate ? LockClosedIcon : HashtagIcon
  return <Icon className="h-3.5 w-3.5 text-muted-foreground" />
}

function useSlackChannels() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['slack-channels'],
    queryFn: () => fetchSlackChannelsFn({ data: { force: false } }),
    staleTime: 5 * 60 * 1000, // 5 minutes — matches server-side Dragonfly TTL
    retry: 1,
  })

  const refresh = () => {
    queryClient.fetchQuery({
      queryKey: ['slack-channels'],
      queryFn: () => fetchSlackChannelsFn({ data: { force: true } }),
    })
  }

  return {
    channels: query.data ?? [],
    loading: query.isLoading || query.isFetching,
    error: query.isError ? 'Failed to load channels. Please try again.' : null,
    refresh,
  }
}

// ============================================
// Searchable Channel Picker
// ============================================

function ChannelPicker({
  channels,
  value,
  onSelect,
  loading,
  onRefresh,
  placeholder = 'Select a channel...',
}: {
  channels: SlackChannel[]
  value: string
  onSelect: (channelId: string) => void
  loading?: boolean
  onRefresh?: () => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = channels.find((c) => c.id === value)
  const filtered = useMemo(
    () =>
      search
        ? channels.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
        : channels,
    [channels, search]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {loading ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
              Loading channels...
            </span>
          ) : selected ? (
            <span className="flex items-center gap-2">
              <ChannelIcon isPrivate={selected.isPrivate} />
              {selected.name}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronUpDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search channels..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title="Refresh channels"
            >
              <ArrowPathIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
        <div className="max-h-[200px] overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              {search ? 'No channels match your search.' : 'No channels available.'}
            </div>
          ) : (
            filtered.map((channel) => (
              <button
                key={channel.id}
                type="button"
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors ${
                  channel.id === value ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
                }`}
                onClick={() => {
                  onSelect(channel.id)
                  setOpen(false)
                  setSearch('')
                }}
              >
                <ChannelIcon isPrivate={channel.isPrivate} />
                <span className="truncate">{channel.name}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ============================================
// Monitored Channel Row
// ============================================

function MonitoredChannelRow({
  monitor,
  channelInfo,
  integrationId,
  disabled,
  boards,
}: {
  monitor: MonitoredChannel
  channelInfo: SlackChannel | undefined
  integrationId: string
  disabled: boolean
  boards: { id: string; name: string }[]
}) {
  const updateMutation = useUpdateMonitoredChannel()
  const removeMutation = useRemoveMonitoredChannel()
  const [confirmRemove, setConfirmRemove] = useState(false)

  const channelName = channelInfo?.name || monitor.channelName
  const isPrivate = channelInfo?.isPrivate ?? false

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/10 transition-colors">
        <ChannelIcon isPrivate={isPrivate} />
        <span className="text-sm font-medium truncate min-w-0 flex-1">{channelName}</span>
        <Select
          value={monitor.boardId ?? '__all__'}
          onValueChange={(val) =>
            updateMutation.mutate({
              integrationId,
              channelId: monitor.channelId,
              boardId: val === '__all__' ? null : val,
            })
          }
          disabled={disabled || updateMutation.isPending}
        >
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All boards</SelectItem>
            {boards.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Switch
          checked={monitor.enabled}
          onCheckedChange={(checked) =>
            updateMutation.mutate({
              integrationId,
              channelId: monitor.channelId,
              enabled: checked,
            })
          }
          disabled={disabled || updateMutation.isPending}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          onClick={() => setConfirmRemove(true)}
          disabled={disabled}
        >
          <XMarkIcon className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove monitored channel</DialogTitle>
            <DialogDescription>
              Stop monitoring #{channelName} for feedback? Messages will no longer be automatically
              ingested.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                removeMutation.mutate(
                  { integrationId, channelId: monitor.channelId },
                  { onSuccess: () => setConfirmRemove(false) }
                )
              }
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? 'Removing...' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ============================================
// Add Monitored Channel Dialog
// ============================================

function AddMonitoredChannelDialog({
  open,
  onOpenChange,
  integrationId,
  channels,
  loadingChannels,
  existingMonitoredIds,
  boards,
  onRefreshChannels,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  integrationId: string
  channels: SlackChannel[]
  loadingChannels: boolean
  existingMonitoredIds: string[]
  boards: { id: string; name: string }[]
  onRefreshChannels: () => void
}) {
  const addMutation = useAddMonitoredChannel()
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [boardId, setBoardId] = useState<string | null>(null)

  const availableChannels = channels.filter((c) => !existingMonitoredIds.includes(c.id))
  const selectedChannel = channels.find((c) => c.id === selectedChannelId)

  const handleSave = () => {
    if (!selectedChannelId || !selectedChannel) return

    addMutation.mutate(
      {
        integrationId,
        channelId: selectedChannelId,
        channelName: selectedChannel.name,
        isPrivate: selectedChannel.isPrivate,
        boardId,
      },
      {
        onSuccess: () => {
          onOpenChange(false)
          setSelectedChannelId('')
          setBoardId(null)
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Monitor a channel</DialogTitle>
          <DialogDescription>
            All messages in this channel will be automatically screened for feedback by AI.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Channel</Label>
            <ChannelPicker
              channels={availableChannels}
              value={selectedChannelId}
              onSelect={setSelectedChannelId}
              loading={loadingChannels}
              onRefresh={onRefreshChannels}
            />
          </div>

          {selectedChannel?.isPrivate && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              The bot must be manually invited to private channels to receive messages.
            </p>
          )}

          {boards.length > 0 && (
            <div className="space-y-1.5">
              <Label>Board (optional)</Label>
              <Select
                value={boardId ?? '__none__'}
                onValueChange={(val) => setBoardId(val === '__none__' ? null : val)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">All boards</SelectItem>
                  {boards.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Feedback from this channel will be assigned to this board.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!selectedChannelId || addMutation.isPending}>
            {addMutation.isPending ? 'Adding...' : 'Monitor channel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================
// Main Component
// ============================================

export function SlackConfig({
  integrationId,
  initialConfig,
  initialEventMappings,
  notificationChannels: initialChannels,
  monitoredChannels: initialMonitoredChannels,
  enabled,
}: SlackConfigProps) {
  const updateMutation = useUpdateIntegration()
  const {
    channels,
    loading: loadingChannels,
    error: channelError,
    refresh: refreshChannels,
  } = useSlackChannels()
  const boardsQuery = useQuery(adminQueries.boards())
  const boards = (boardsQuery.data ?? []).map((b) => ({ id: b.id, name: b.name }))
  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)
  const [addMonitorDialogOpen, setAddMonitorDialogOpen] = useState(false)

  // Use notificationChannels if available, otherwise fall back to legacy single-channel
  const notificationChannels: NotificationChannel[] = initialChannels?.length
    ? initialChannels
    : initialConfig.channelId
      ? [
          {
            channelId: initialConfig.channelId,
            events: SLACK_EVENT_CONFIG.map((e) => ({
              eventType: e.id,
              enabled: initialEventMappings.find((m) => m.eventType === e.id)?.enabled ?? false,
            })),
            boardIds: null,
          },
        ]
      : []

  const monitoredChannels = initialMonitoredChannels ?? []
  const existingMonitoredIds = monitoredChannels.map((c) => c.channelId)

  // Check if the integration has the required scopes for channel monitoring
  const scopes = (initialConfig.scopes as string) || ''
  const hasMonitoringScopes = scopes.includes('channels:history')

  const handleEnabledChange = (checked: boolean) => {
    setIntegrationEnabled(checked)
    updateMutation.mutate({ id: integrationId, enabled: checked })
  }

  const saving = updateMutation.isPending

  return (
    <div className="space-y-6">
      {/* Enable/Disable Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="enabled-toggle" className="text-base font-medium">
            Integration enabled
          </Label>
          <p className="text-sm text-muted-foreground">Turn off to pause all Slack features</p>
        </div>
        <Switch
          id="enabled-toggle"
          checked={integrationEnabled}
          onCheckedChange={handleEnabledChange}
          disabled={saving}
        />
      </div>

      <div className="border-t border-border/30" />

      {/* Notification Routing */}
      <div className="space-y-3">
        <div>
          <Label className="text-base font-medium">Notification routing</Label>
          <p className="text-sm text-muted-foreground">
            Choose which events reach each Slack channel
          </p>
        </div>

        <NotificationChannelRouter<SlackChannel>
          integrationId={integrationId}
          enabled={integrationEnabled}
          events={SLACK_EVENT_CONFIG}
          channels={channels}
          notificationChannels={notificationChannels}
          boards={boards}
          loadingChannels={loadingChannels}
          channelError={channelError}
          onRefreshChannels={refreshChannels}
          renderChannelIcon={(channel) => {
            const Icon = channel?.isPrivate ? LockClosedIcon : HashtagIcon
            return <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          }}
        />
      </div>

      <div className="border-t border-border/30" />

      {/* Channel Monitoring */}
      <div className="space-y-3">
        <div>
          <Label className="text-base font-medium">Channel monitoring</Label>
          <p className="text-sm text-muted-foreground">
            Automatically ingest messages from selected channels as feedback. Messages are screened
            by AI to only capture genuine feedback.
          </p>
        </div>

        {!hasMonitoringScopes && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Channel monitoring requires additional permissions. Please disconnect and reconnect
              Slack to authorize the new scopes.
            </p>
          </div>
        )}

        {hasMonitoringScopes && monitoredChannels.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/50 p-8 text-center">
            <p className="text-sm text-muted-foreground">No channels being monitored yet.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1.5"
              onClick={() => setAddMonitorDialogOpen(true)}
              disabled={!integrationEnabled}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Monitor your first channel
            </Button>
          </div>
        )}

        {hasMonitoringScopes && monitoredChannels.length > 0 && (
          <div className="rounded-lg border border-border/50 overflow-hidden">
            <div className="grid grid-cols-[minmax(0,1fr)_140px_48px_32px] items-end bg-muted/40 border-b border-border/50 px-4 py-2">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Channel
              </div>
              <div className="text-[11px] font-medium text-muted-foreground text-center">Board</div>
              <div className="text-[11px] font-medium text-muted-foreground text-center">On</div>
              <div />
            </div>
            {monitoredChannels.map((mc) => (
              <MonitoredChannelRow
                key={mc.channelId}
                monitor={mc}
                channelInfo={channels.find((c) => c.id === mc.channelId)}
                integrationId={integrationId}
                disabled={!integrationEnabled || saving}
                boards={boards}
              />
            ))}
            <button
              type="button"
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/10 transition-colors w-full border-t border-border/50"
              onClick={() => setAddMonitorDialogOpen(true)}
              disabled={!integrationEnabled}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add channel
            </button>
          </div>
        )}
      </div>

      {/* Saving indicator (for enable/disable toggle) */}
      {saving && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}

      {/* Error message */}
      {updateMutation.isError && (
        <div className="text-sm text-destructive">
          {updateMutation.error?.message || 'Failed to save changes'}
        </div>
      )}

      {/* Add Monitored Channel Dialog */}
      <AddMonitoredChannelDialog
        open={addMonitorDialogOpen}
        onOpenChange={setAddMonitorDialogOpen}
        integrationId={integrationId}
        channels={channels}
        loadingChannels={loadingChannels}
        existingMonitoredIds={existingMonitoredIds}
        boards={boards}
        onRefreshChannels={refreshChannels}
      />
    </div>
  )
}
