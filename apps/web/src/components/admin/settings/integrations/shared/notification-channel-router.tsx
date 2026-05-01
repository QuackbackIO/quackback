/**
 * Routing UI for chat-style integrations (Slack, Discord, Teams).
 *
 * Lets admins pick a destination channel per event with optional board filter.
 *
 * NOT for ticket-creation integrations (Jira, Linear, Asana) or
 * broadcast/digest integrations (email, webhooks). Those have a different
 * mental model and should get their own UI rather than be forced through here.
 */

import { useState, useRef, useMemo, useEffect, type ReactNode, type CSSProperties } from 'react'
import {
  ArrowPathIcon,
  XMarkIcon,
  PlusIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  ChevronUpDownIcon,
  CheckIcon,
} from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/shared/utils'
import {
  useAddNotificationChannel,
  useUpdateNotificationChannel,
  useRemoveNotificationChannel,
} from '@/lib/client/mutations'

// ============================================
// Public types
// ============================================

export interface Channel {
  id: string
  name: string
}

export interface NotificationChannel {
  channelId: string
  events: { eventType: string; enabled: boolean }[]
  boardIds: string[] | null
}

export interface EventConfig {
  id: string
  label: string
  shortLabel: string
  description: string
}

export interface Board {
  id: string
  name: string
}

interface NotificationChannelRouterProps<TChannel extends Channel> {
  integrationId: string
  enabled: boolean
  events: EventConfig[]
  channels: TChannel[]
  notificationChannels: NotificationChannel[]
  boards: Board[]
  loadingChannels: boolean
  channelError: string | null
  onRefreshChannels: () => void
  renderChannelIcon: (channel: TChannel | undefined) => ReactNode
}

// ============================================
// Public component
// ============================================

export function NotificationChannelRouter<TChannel extends Channel>(
  props: NotificationChannelRouterProps<TChannel>
) {
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const existingChannelIds = useMemo(
    () => props.notificationChannels.map((c) => c.channelId),
    [props.notificationChannels]
  )

  return (
    <div className="space-y-3">
      {props.channelError && <p className="text-sm text-destructive">{props.channelError}</p>}

      {props.notificationChannels.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">No notification channels configured yet.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 gap-1.5"
            onClick={() => setAddDialogOpen(true)}
            disabled={!props.enabled}
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Add your first channel
          </Button>
        </div>
      ) : (
        <RoutingTable<TChannel>
          channels={props.notificationChannels}
          channelInfoList={props.channels}
          integrationId={props.integrationId}
          disabled={!props.enabled}
          boards={props.boards}
          events={props.events}
          renderChannelIcon={props.renderChannelIcon}
          onAddChannel={props.enabled ? () => setAddDialogOpen(true) : undefined}
        />
      )}

      <AddChannelDialog<TChannel>
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        integrationId={props.integrationId}
        channels={props.channels}
        loadingChannels={props.loadingChannels}
        existingChannelIds={existingChannelIds}
        boards={props.boards}
        events={props.events}
        renderChannelIcon={props.renderChannelIcon}
        onRefreshChannels={props.onRefreshChannels}
      />
    </div>
  )
}

// ============================================
// Helpers
// ============================================

function getBoardSummary(channel: NotificationChannel, boards: Board[]): string {
  if (!channel.boardIds?.length) return 'All boards'
  if (channel.boardIds.length === 1) {
    return boards.find((b) => b.id === channel.boardIds![0])?.name ?? '1 board'
  }
  const firstName = boards.find((b) => b.id === channel.boardIds![0])?.name
  if (firstName) return `${firstName} + ${channel.boardIds.length - 1} more`
  return `${channel.boardIds.length} boards`
}

/**
 * Inline grid-template-columns for the routing table.
 *
 * Built as inline style instead of a `grid-cols-[...]` Tailwind class because
 * Tailwind's JIT scanner only emits CSS for class strings it sees literally
 * in source — a dynamic template-literal class wouldn't get its CSS generated
 * and the grid would silently collapse.
 */
function tableGridStyle(eventCount: number): CSSProperties {
  return { gridTemplateColumns: `minmax(0,1fr) ${'5rem '.repeat(eventCount).trim()}` }
}

// ============================================
// Internal component interfaces
// ============================================

interface RoutingTableProps<TChannel extends Channel> {
  channels: NotificationChannel[]
  channelInfoList: TChannel[]
  integrationId: string
  disabled: boolean
  boards: Board[]
  events: EventConfig[]
  renderChannelIcon: (channel: TChannel | undefined) => ReactNode
  onAddChannel?: () => void
}

interface AddChannelDialogProps<TChannel extends Channel> {
  open: boolean
  onOpenChange: (open: boolean) => void
  integrationId: string
  channels: TChannel[]
  loadingChannels: boolean
  existingChannelIds: string[]
  boards: Board[]
  events: EventConfig[]
  renderChannelIcon: (channel: TChannel | undefined) => ReactNode
  onRefreshChannels: () => void
}

// ============================================
// Searchable Channel Picker
// ============================================

function ChannelPicker<TChannel extends Channel>({
  channels,
  value,
  onSelect,
  loading,
  onRefresh,
  renderChannelIcon,
  placeholder = 'Select a channel...',
}: {
  channels: TChannel[]
  value: string
  onSelect: (channelId: string) => void
  loading?: boolean
  onRefresh?: () => void
  renderChannelIcon: (channel: TChannel | undefined) => ReactNode
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
              {renderChannelIcon(selected)}
              {selected.name}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
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
                {renderChannelIcon(channel)}
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
// Board Filter (searchable multi-select)
// ============================================

function BoardFilterCombobox({
  boardIds,
  boards,
  onBoardIdsChange,
  disabled,
  ariaLabel = 'Board filter',
}: {
  boardIds: string[] | null
  boards: Board[]
  onBoardIdsChange: (boardIds: string[] | null) => void
  disabled?: boolean
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const isAllBoards = !boardIds?.length
  const selectedSet = useMemo(() => new Set(boardIds ?? []), [boardIds])

  const triggerLabel = isAllBoards
    ? 'All boards'
    : boardIds!.length === 1
      ? (boards.find((b) => b.id === boardIds![0])?.name ?? '1 board')
      : `${boardIds!.length} boards`

  const toggleBoard = (id: string) => {
    if (selectedSet.has(id)) {
      const next = (boardIds ?? []).filter((b) => b !== id)
      onBoardIdsChange(next.length > 0 ? next : null)
    } else {
      onBoardIdsChange([...(boardIds ?? []), id])
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', isAllBoards && 'text-muted-foreground')}>
            {triggerLabel}
          </span>
          <ChevronUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        {open && (
          <Command>
            <CommandInput placeholder="Search boards..." />
            <CommandList>
              <CommandEmpty>No boards found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__all_boards__"
                  onSelect={() => {
                    onBoardIdsChange(null)
                    setOpen(false)
                  }}
                >
                  <CheckIcon
                    className={cn('mr-2 h-4 w-4', isAllBoards ? 'opacity-100' : 'opacity-0')}
                  />
                  All boards
                </CommandItem>
              </CommandGroup>
              {boards.length > 0 && <CommandSeparator />}
              <CommandGroup>
                {boards.map((board) => (
                  <CommandItem
                    key={board.id}
                    value={board.name}
                    onSelect={() => toggleBoard(board.id)}
                  >
                    <CheckIcon
                      className={cn(
                        'mr-2 h-4 w-4',
                        selectedSet.has(board.id) ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="truncate">{board.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ============================================
// Channel Row (table row with expandable detail)
// ============================================

function ChannelRow<TChannel extends Channel>({
  channel,
  channelInfo,
  integrationId,
  disabled,
  expanded,
  onToggleExpand,
  boards,
  hasBorder,
  events,
  renderChannelIcon,
}: {
  channel: NotificationChannel
  channelInfo: TChannel | undefined
  integrationId: string
  disabled: boolean
  expanded: boolean
  onToggleExpand: () => void
  boards: Board[]
  hasBorder: boolean
  events: EventConfig[]
  renderChannelIcon: (c: TChannel | undefined) => ReactNode
}) {
  const updateMutation = useUpdateNotificationChannel()
  const removeMutation = useRemoveNotificationChannel()
  const [confirmRemove, setConfirmRemove] = useState(false)

  const channelName = channelInfo?.name || channel.channelId
  const saving = updateMutation.isPending
  const hasFilter = !!channel.boardIds?.length

  const handleEventToggle = (eventId: string, checked: boolean) => {
    updateMutation.mutate({
      integrationId,
      channelId: channel.channelId,
      events: events.map((e) => ({
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
      events: events.map((e) => ({
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
        <div
          className="grid items-center hover:bg-muted/10 transition-colors cursor-pointer"
          style={tableGridStyle(events.length)}
          onClick={onToggleExpand}
        >
          <div className="flex items-center gap-2 px-4 py-3">
            <ChevronRightIcon
              className={`h-3 w-3 text-muted-foreground shrink-0 transition-transform duration-150 ${
                expanded ? 'rotate-90' : ''
              }`}
            />
            {renderChannelIcon(channelInfo)}
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-sm font-medium truncate">{channelName}</span>
              {hasFilter && (
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {getBoardSummary(channel, boards)}
                </span>
              )}
            </div>
          </div>

          {events.map((event) => {
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

        {expanded && (
          <div className="border-t border-border/30 bg-muted/5 px-4 pb-4">
            <div className="pl-10 pt-3 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Board filter</Label>
                <BoardFilterCombobox
                  boardIds={channel.boardIds}
                  boards={boards}
                  onBoardIdsChange={handleBoardIdsChange}
                  disabled={disabled || saving}
                />
              </div>
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

function RoutingTable<TChannel extends Channel>({
  channels: notificationChannels,
  channelInfoList,
  integrationId,
  disabled,
  boards,
  events,
  renderChannelIcon,
  onAddChannel,
}: RoutingTableProps<TChannel>) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      <div
        className="grid items-end bg-muted/40 border-b border-border/50"
        style={tableGridStyle(events.length)}
      >
        <div className="px-4 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Channel
        </div>
        {events.map((event) => (
          <div
            key={event.id}
            className="py-2 text-[11px] font-medium text-muted-foreground text-center leading-tight"
            title={event.label}
          >
            {event.shortLabel}
          </div>
        ))}
      </div>

      {notificationChannels.map((nc, idx) => (
        <ChannelRow<TChannel>
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
          events={events}
          renderChannelIcon={renderChannelIcon}
        />
      ))}

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

function AddChannelDialog<TChannel extends Channel>({
  open,
  onOpenChange,
  integrationId,
  channels,
  loadingChannels,
  existingChannelIds,
  boards,
  events,
  renderChannelIcon,
  onRefreshChannels,
}: AddChannelDialogProps<TChannel>) {
  const addMutation = useAddNotificationChannel()
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(events.map((e) => [e.id, true]))
  )
  const [boardIds, setBoardIds] = useState<string[] | null>(null)

  // Reset form state whenever the dialog closes (cancel, X, or save).
  useEffect(() => {
    if (!open) {
      setSelectedChannelId('')
      setSelectedEvents(Object.fromEntries(events.map((e) => [e.id, true])))
      setBoardIds(null)
    }
  }, [open, events])

  const availableChannels = channels.filter((c) => !existingChannelIds.includes(c.id))
  const allEventsSelected = events.every((e) => selectedEvents[e.id])
  const noEventsSelected = events.every((e) => !selectedEvents[e.id])

  const handleSave = () => {
    if (!selectedChannelId) return
    const eventsToSave = Object.entries(selectedEvents)
      .filter(([, enabled]) => enabled)
      .map(([eventType]) => eventType)

    if (eventsToSave.length === 0) return

    addMutation.mutate(
      {
        integrationId,
        channelId: selectedChannelId,
        events: eventsToSave,
        boardIds: boardIds ?? undefined,
      },
      {
        onSuccess: () => onOpenChange(false),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add notification channel</DialogTitle>
          <DialogDescription>Route events to a channel.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Channel</Label>
            <ChannelPicker<TChannel>
              channels={availableChannels}
              value={selectedChannelId}
              onSelect={setSelectedChannelId}
              loading={loadingChannels}
              onRefresh={onRefreshChannels}
              renderChannelIcon={renderChannelIcon}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Events</Label>
              <button
                type="button"
                onClick={() => {
                  const next = allEventsSelected ? false : true
                  setSelectedEvents(Object.fromEntries(events.map((e) => [e.id, next])))
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {allEventsSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {events.map((event) => (
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

          <div className="space-y-1.5">
            <Label>Board filter</Label>
            <BoardFilterCombobox
              boardIds={boardIds}
              boards={boards}
              onBoardIdsChange={setBoardIds}
              disabled={addMutation.isPending}
            />
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
