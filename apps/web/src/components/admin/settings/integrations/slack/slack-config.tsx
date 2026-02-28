import { useState, useEffect, useCallback } from 'react'
import {
  ArrowPathIcon,
  HashtagIcon,
  LockClosedIcon,
  XMarkIcon,
  PlusIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  useUpdateIntegration,
  useAddNotificationChannel,
  useUpdateNotificationChannel,
  useRemoveNotificationChannel,
} from '@/lib/client/mutations'
import { adminQueries } from '@/lib/client/queries/admin'
import { useQuery } from '@tanstack/react-query'
import { fetchSlackChannelsFn, type SlackChannel } from '@/lib/server/integrations/slack/functions'

// ============================================
// Types
// ============================================

interface NotificationChannel {
  channelId: string
  events: { eventType: string; enabled: boolean }[]
  boardIds: string[] | null
}

interface SlackConfigProps {
  integrationId: string
  initialConfig: { channelId?: string }
  initialEventMappings: { id: string; eventType: string; enabled: boolean }[]
  notificationChannels?: NotificationChannel[]
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

/** Grid: flexible channel column + 4 fixed event columns */
const TABLE_GRID = 'grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_5rem]'

// ============================================
// Helpers
// ============================================

function ChannelIcon({ isPrivate }: { isPrivate: boolean }) {
  const Icon = isPrivate ? LockClosedIcon : HashtagIcon
  return <Icon className="h-3.5 w-3.5 text-muted-foreground" />
}

function getBoardSummary(
  channel: NotificationChannel,
  boards: { id: string; name: string }[]
): string {
  if (!channel.boardIds?.length) return 'All boards'
  if (channel.boardIds.length === 1) {
    return boards.find((b) => b.id === channel.boardIds![0])?.name ?? '1 board'
  }
  // Show first board name + count
  const firstName = boards.find((b) => b.id === channel.boardIds![0])?.name
  if (firstName) return `${firstName} + ${channel.boardIds.length - 1} more`
  return `${channel.boardIds.length} boards`
}

function useSlackChannels() {
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchSlackChannelsFn()
      setChannels(result)
    } catch {
      setError('Failed to load channels. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch()
  }, [fetch])

  return { channels, loading, error, refresh: fetch }
}

// ============================================
// Board Filter Pills
// ============================================

function BoardFilterPills({
  boardIds,
  boards,
  onBoardIdsChange,
  disabled,
}: {
  boardIds: string[] | null
  boards: { id: string; name: string }[]
  onBoardIdsChange: (boardIds: string[] | null) => void
  disabled?: boolean
}) {
  const isAllBoards = !boardIds?.length

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">Board filter</div>
      <div className="space-y-2">
        {/* All boards radio */}
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={isAllBoards}
            onCheckedChange={(checked) => {
              if (checked) onBoardIdsChange(null)
            }}
            disabled={disabled}
          />
          All boards
        </label>
        {/* Specific boards radio */}
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={!isAllBoards}
            onCheckedChange={(checked) => {
              if (checked) {
                // Select all boards individually to start
                onBoardIdsChange(boards.map((b) => b.id))
              } else {
                onBoardIdsChange(null)
              }
            }}
            disabled={disabled}
          />
          Specific boards
        </label>
        {/* Board list — only shown when "Specific boards" is selected */}
        {!isAllBoards && (
          <div className="ml-6 flex flex-wrap gap-1.5 pt-0.5">
            {boards.map((board) => {
              const selected = boardIds?.includes(board.id) ?? false
              return (
                <button
                  key={board.id}
                  type="button"
                  className={`px-2.5 py-1 text-xs rounded-md border transition-colors disabled:opacity-50 ${
                    selected
                      ? 'bg-primary/10 border-primary/20 text-primary font-medium'
                      : 'border-border/60 text-muted-foreground hover:bg-muted/50'
                  }`}
                  onClick={() => {
                    if (selected) {
                      const next = (boardIds ?? []).filter((id) => id !== board.id)
                      // If deselecting last board, go back to "All boards"
                      onBoardIdsChange(next.length > 0 ? next : null)
                    } else {
                      onBoardIdsChange([...(boardIds ?? []), board.id])
                    }
                  }}
                  disabled={disabled}
                >
                  {board.name}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// Channel Row (table row with expandable detail)
// ============================================

function ChannelRow({
  channel,
  channelInfo,
  integrationId,
  disabled,
  expanded,
  onToggleExpand,
  boards,
  hasBorder,
}: {
  channel: NotificationChannel
  channelInfo: SlackChannel | undefined
  integrationId: string
  disabled: boolean
  expanded: boolean
  onToggleExpand: () => void
  boards: { id: string; name: string }[]
  hasBorder: boolean
}) {
  const updateMutation = useUpdateNotificationChannel()
  const removeMutation = useRemoveNotificationChannel()
  const [confirmRemove, setConfirmRemove] = useState(false)

  const channelName = channelInfo?.name || channel.channelId
  const isPrivate = channelInfo?.isPrivate ?? false
  const saving = updateMutation.isPending
  const hasFilter = !!channel.boardIds?.length

  const handleEventToggle = (eventId: string, checked: boolean) => {
    updateMutation.mutate({
      integrationId,
      channelId: channel.channelId,
      events: SLACK_EVENT_CONFIG.map((e) => ({
        eventType: e.id,
        enabled:
          e.id === eventId
            ? checked
            : (channel.events.find((ev) => ev.eventType === e.id)?.enabled ?? false),
      })),
      boardIds: channel.boardIds,
    })
  }

  const handleBoardIdsChange = (boardIds: string[] | null) => {
    updateMutation.mutate({
      integrationId,
      channelId: channel.channelId,
      events: SLACK_EVENT_CONFIG.map((e) => ({
        eventType: e.id,
        enabled: channel.events.find((ev) => ev.eventType === e.id)?.enabled ?? false,
      })),
      boardIds,
    })
  }

  const handleRemove = () => {
    removeMutation.mutate(
      { integrationId, channelId: channel.channelId },
      { onSuccess: () => setConfirmRemove(false) }
    )
  }

  return (
    <>
      <div className={hasBorder ? 'border-b border-border/50' : ''}>
        {/* Main row — full-row hover */}
        <div
          className={`grid ${TABLE_GRID} items-center hover:bg-muted/10 transition-colors cursor-pointer`}
          onClick={onToggleExpand}
        >
          {/* Channel cell */}
          <div className="flex items-center gap-2 px-4 py-3">
            <ChevronRightIcon
              className={`h-3 w-3 text-muted-foreground shrink-0 transition-transform duration-150 ${
                expanded ? 'rotate-90' : ''
              }`}
            />
            <ChannelIcon isPrivate={isPrivate} />
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-sm font-medium truncate">{channelName}</span>
              {hasFilter && (
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {getBoardSummary(channel, boards)}
                </span>
              )}
            </div>
          </div>

          {/* Event toggle cells */}
          {SLACK_EVENT_CONFIG.map((event) => {
            const enabled = channel.events.find((e) => e.eventType === event.id)?.enabled ?? false
            return (
              <div
                key={event.id}
                className="flex justify-center py-3"
                onClick={(e) => e.stopPropagation()}
              >
                <Checkbox
                  checked={enabled}
                  onCheckedChange={(checked) => handleEventToggle(event.id, checked === true)}
                  disabled={disabled || saving}
                />
              </div>
            )
          })}
        </div>

        {/* Expanded detail — board filter + remove */}
        {expanded && (
          <div className="border-t border-border/30 bg-muted/5 px-4 pb-4">
            <div className="pl-10 pt-3 space-y-3">
              <BoardFilterPills
                boardIds={channel.boardIds}
                boards={boards}
                onBoardIdsChange={handleBoardIdsChange}
                disabled={disabled || saving}
              />
              <div className="pt-2 border-t border-border/30">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmRemove(true)}
                  disabled={disabled}
                >
                  <XMarkIcon className="h-3.5 w-3.5 mr-1" />
                  Remove channel
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Remove confirmation */}
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove notification channel</DialogTitle>
            <DialogDescription>
              Stop sending notifications to #{channelName}? This will delete all event mappings for
              this channel.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemove}
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
// Routing Table
// ============================================

function RoutingTable({
  channels: notificationChannels,
  channelInfoList,
  integrationId,
  disabled,
  boards,
  onAddChannel,
}: {
  channels: NotificationChannel[]
  channelInfoList: SlackChannel[]
  integrationId: string
  disabled: boolean
  boards: { id: string; name: string }[]
  onAddChannel?: () => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      {/* Header */}
      <div className={`grid ${TABLE_GRID} items-end bg-muted/40 border-b border-border/50`}>
        <div className="px-4 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Channel
        </div>
        {SLACK_EVENT_CONFIG.map((event) => (
          <div
            key={event.id}
            className="py-2 text-[11px] font-medium text-muted-foreground text-center leading-tight"
            title={event.label}
          >
            {event.shortLabel}
          </div>
        ))}
      </div>

      {/* Channel rows */}
      {notificationChannels.map((nc, idx) => (
        <ChannelRow
          key={nc.channelId}
          channel={nc}
          channelInfo={channelInfoList.find((c) => c.id === nc.channelId)}
          integrationId={integrationId}
          disabled={disabled}
          expanded={expandedId === nc.channelId}
          onToggleExpand={() =>
            setExpandedId((prev) => (prev === nc.channelId ? null : nc.channelId))
          }
          boards={boards}
          hasBorder={idx < notificationChannels.length - 1 || expandedId === nc.channelId}
        />
      ))}

      {/* Add channel row — inside table */}
      {onAddChannel && (
        <button
          type="button"
          className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/10 transition-colors w-full border-t border-border/50"
          onClick={onAddChannel}
          disabled={disabled}
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Add channel
        </button>
      )}
    </div>
  )
}

// ============================================
// Add Channel Dialog
// ============================================

function AddChannelDialog({
  open,
  onOpenChange,
  integrationId,
  channels,
  loadingChannels,
  existingChannelIds,
  boards,
  onRefreshChannels,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  integrationId: string
  channels: SlackChannel[]
  loadingChannels: boolean
  existingChannelIds: string[]
  boards: { id: string; name: string }[]
  onRefreshChannels: () => void
}) {
  const addMutation = useAddNotificationChannel()
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SLACK_EVENT_CONFIG.map((e) => [e.id, true]))
  )
  const [boardIds, setBoardIds] = useState<string[] | null>(null)
  const [showBoardFilter, setShowBoardFilter] = useState(false)

  const availableChannels = channels.filter((c) => !existingChannelIds.includes(c.id))
  const allEventsSelected = SLACK_EVENT_CONFIG.every((e) => selectedEvents[e.id])
  const noEventsSelected = SLACK_EVENT_CONFIG.every((e) => !selectedEvents[e.id])

  const handleSave = () => {
    if (!selectedChannelId) return
    const events = Object.entries(selectedEvents)
      .filter(([, enabled]) => enabled)
      .map(([eventType]) => eventType)

    if (events.length === 0) return

    addMutation.mutate(
      {
        integrationId,
        channelId: selectedChannelId,
        events,
        boardIds: boardIds ?? undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false)
          setSelectedChannelId('')
          setSelectedEvents(Object.fromEntries(SLACK_EVENT_CONFIG.map((e) => [e.id, true])))
          setBoardIds(null)
          setShowBoardFilter(false)
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add notification channel</DialogTitle>
          <DialogDescription>Route events to a Slack channel.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Channel selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Channel</Label>
              <button
                type="button"
                onClick={onRefreshChannels}
                disabled={loadingChannels}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                <ArrowPathIcon className={`h-3 w-3 ${loadingChannels ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
            <Select value={selectedChannelId} onValueChange={setSelectedChannelId}>
              <SelectTrigger>
                {loadingChannels ? (
                  <div className="flex items-center gap-2">
                    <ArrowPathIcon className="h-4 w-4 animate-spin" />
                    <span>Loading channels...</span>
                  </div>
                ) : (
                  <SelectValue placeholder="Select a channel" />
                )}
              </SelectTrigger>
              <SelectContent>
                {availableChannels.map((channel) => (
                  <SelectItem key={channel.id} value={channel.id}>
                    <div className="flex items-center gap-2">
                      <ChannelIcon isPrivate={channel.isPrivate} />
                      <span>{channel.name}</span>
                    </div>
                  </SelectItem>
                ))}
                {availableChannels.length === 0 && !loadingChannels && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No available channels
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Events — compact 2-column grid */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Events</Label>
              <button
                type="button"
                onClick={() => {
                  const next = allEventsSelected ? false : true
                  setSelectedEvents(Object.fromEntries(SLACK_EVENT_CONFIG.map((e) => [e.id, next])))
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {allEventsSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {SLACK_EVENT_CONFIG.map((event) => (
                <label
                  key={event.id}
                  className="flex items-center gap-2 text-sm cursor-pointer py-1"
                >
                  <Checkbox
                    checked={selectedEvents[event.id] ?? true}
                    onCheckedChange={(checked) =>
                      setSelectedEvents((prev) => ({
                        ...prev,
                        [event.id]: checked === true,
                      }))
                    }
                  />
                  {event.shortLabel}
                </label>
              ))}
            </div>
          </div>

          {/* Board filter — collapsed by default */}
          <div className="space-y-1.5">
            {!showBoardFilter && !boardIds?.length ? (
              <button
                type="button"
                onClick={() => setShowBoardFilter(true)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <PlusIcon className="h-3 w-3" />
                Filter by board
              </button>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Board filter</Label>
                  {boardIds?.length ? (
                    <button
                      type="button"
                      onClick={() => {
                        setBoardIds(null)
                        setShowBoardFilter(false)
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {boards.map((board) => {
                    const selected = boardIds?.includes(board.id) ?? false
                    return (
                      <button
                        key={board.id}
                        type="button"
                        className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                          selected
                            ? 'bg-primary/10 border-primary/20 text-primary font-medium'
                            : 'border-border/60 text-muted-foreground hover:bg-muted/50'
                        }`}
                        onClick={() => {
                          if (selected) {
                            const next = (boardIds ?? []).filter((id) => id !== board.id)
                            setBoardIds(next.length > 0 ? next : null)
                          } else {
                            setBoardIds([...(boardIds ?? []), board.id])
                          }
                        }}
                      >
                        {board.name}
                      </button>
                    )
                  })}
                </div>
                {!boardIds?.length && (
                  <p className="text-[11px] text-muted-foreground">
                    Select boards to filter, or leave empty for all boards.
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!selectedChannelId || noEventsSelected || addMutation.isPending}
          >
            {addMutation.isPending ? 'Adding...' : 'Add channel'}
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
  const [addDialogOpen, setAddDialogOpen] = useState(false)

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

  const existingChannelIds = notificationChannels.map((c) => c.channelId)

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
            Notifications enabled
          </Label>
          <p className="text-sm text-muted-foreground">Turn off to pause all Slack notifications</p>
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

        {channelError && <p className="text-sm text-destructive">{channelError}</p>}

        {notificationChannels.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/50 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No notification channels configured yet.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1.5"
              onClick={() => setAddDialogOpen(true)}
              disabled={!integrationEnabled}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add your first channel
            </Button>
          </div>
        ) : (
          <RoutingTable
            channels={notificationChannels}
            channelInfoList={channels}
            integrationId={integrationId}
            disabled={!integrationEnabled || saving}
            boards={boards}
            onAddChannel={integrationEnabled ? () => setAddDialogOpen(true) : undefined}
          />
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

      {/* Add Channel Dialog */}
      <AddChannelDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        integrationId={integrationId}
        channels={channels}
        loadingChannels={loadingChannels}
        existingChannelIds={existingChannelIds}
        boards={boards}
        onRefreshChannels={refreshChannels}
      />
    </div>
  )
}
