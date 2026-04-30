/**
 * Routing UI for chat-style integrations (Slack, Discord, Teams).
 *
 * Lets admins pick a destination channel per event with optional board filter.
 *
 * NOT for ticket-creation integrations (Jira, Linear, Asana) or
 * broadcast/digest integrations (email, webhooks). Those have a different
 * mental model and should get their own UI rather than be forced through here.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { useState, useRef, useMemo, type ReactNode } from 'react'
import {
  ArrowPathIcon,
  XMarkIcon,
  PlusIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  ChevronUpDownIcon,
} from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  const existingChannelIds = props.notificationChannels.map((c) => c.channelId)

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
// Internal components (stubs) — see Task 1.2 for full bodies
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

function RoutingTable<TChannel extends Channel>(_props: RoutingTableProps<TChannel>): null {
  return null
}

function AddChannelDialog<TChannel extends Channel>(_props: AddChannelDialogProps<TChannel>): null {
  return null
}
