# Discord per-board channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Discord notification config to feature parity with Slack — per-channel routing with per-board filters — by extracting a chat-scoped shared component, then wiring Discord through it.

**Architecture:** Two PRs with a hard checkpoint between them. PR1 extracts `NotificationChannelRouter` from `slack-config.tsx` into a shared file and refactors Slack to consume it (zero UX change). PR2 wires Discord's route + config component to the shared component, adds a one-time migration to consolidate stale `target_key='default'` rows on chat integrations, and deletes the legacy Discord single-channel UI.

**Tech Stack:** TanStack Start, React, Tailwind v4 + shadcn/ui, Drizzle, Postgres, react-query, @heroicons/react, Playwright (E2E), Bun.

**Spec:** `docs/superpowers/specs/2026-04-30-discord-per-board-channels-design.md`

---

## File structure

### PR1 — Extract + Slack refactor

**Create:**

- `apps/web/src/components/admin/settings/integrations/shared/notification-channel-router.tsx` — chat-scoped routing UI. Exports `NotificationChannelRouter` and shared types `Channel`, `NotificationChannel`, `EventConfig`. Internal: `RoutingTable`, `ChannelRow`, `BoardFilterPills`, `AddChannelDialog`, `ChannelPicker`.

**Modify:**

- `apps/web/src/components/admin/settings/integrations/slack/slack-config.tsx` — delete extracted code, render `<NotificationChannelRouter>`, pass Slack-specific `renderChannelIcon` and `events`. Keep `useSlackChannels`, `MonitoredChannelRow`, `AddMonitoredChannelDialog`, scopes check, integration toggle, `SLACK_EVENT_CONFIG`, legacy fallback synth.

### PR2 — Discord per-board + migration

**Create:**

- `packages/db/drizzle/0048_consolidate_chat_target_keys.sql` — one-time data cleanup migration.
- `apps/web/e2e/tests/admin/integrations-discord-routing.spec.ts` — new E2E coverage for Discord (3 events).
- `apps/web/e2e/tests/admin/integrations-slack-routing.spec.ts` — new E2E coverage for Slack (4 events, public/private icons). Sibling spec so the shared `NotificationChannelRouter` is exercised through both consumers.

**Modify:**

- `apps/web/src/routes/admin/settings/integrations/discord.tsx` — pass `notificationChannels` prop.
- `apps/web/src/components/admin/settings/integrations/discord/discord-config.tsx` — replace body with `<NotificationChannelRouter>`. Add `useDiscordChannels` hook. Define `DISCORD_EVENT_CONFIG`. Delete legacy single-channel form.

---

## Phase 1 — PR1: Extract NotificationChannelRouter

### Task 1.1: Create shared component skeleton with types and docstring

**Files:**

- Create: `apps/web/src/components/admin/settings/integrations/shared/notification-channel-router.tsx`

- [ ] **Step 1: Create the shared file with header, types, and exported component signature**

Create `apps/web/src/components/admin/settings/integrations/shared/notification-channel-router.tsx`:

```tsx
/**
 * Routing UI for chat-style integrations (Slack, Discord, Teams).
 *
 * Lets admins pick a destination channel per event with optional board filter.
 *
 * NOT for ticket-creation integrations (Jira, Linear, Asana) or
 * broadcast/digest integrations (email, webhooks). Those have a different
 * mental model and should get their own UI rather than be forced through here.
 */

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

// Internal components below — see Task 1.2 for full bodies.
function RoutingTable<TChannel extends Channel>(_props: unknown): null {
  return null
}
function AddChannelDialog<TChannel extends Channel>(_props: unknown): null {
  return null
}
```

These two stub functions are placeholders we'll fill in Task 1.2. They're typed as returning `null` so the file typechecks.

- [ ] **Step 2: Verify the file typechecks**

Run: `bun run typecheck`
Expected: passes (no new errors). The stubs are unused at this point.

- [ ] **Step 3: Commit the skeleton**

```bash
git add apps/web/src/components/admin/settings/integrations/shared/notification-channel-router.tsx
git commit -m "feat(integrations): add NotificationChannelRouter skeleton"
```

---

### Task 1.2: Port routing-table internals from slack-config.tsx

**Files:**

- Modify: `apps/web/src/components/admin/settings/integrations/shared/notification-channel-router.tsx`

Port the existing internal components from `apps/web/src/components/admin/settings/integrations/slack/slack-config.tsx`. Keep behavior identical; only change is making `events`, `channels`, and `renderChannelIcon` come from props instead of module-scope constants.

- [ ] **Step 1: Port `getBoardSummary` helper**

Add at the top of the file (after the public component):

```tsx
function getBoardSummary(channel: NotificationChannel, boards: Board[]): string {
  if (!channel.boardIds?.length) return 'All boards'
  if (channel.boardIds.length === 1) {
    return boards.find((b) => b.id === channel.boardIds![0])?.name ?? '1 board'
  }
  const firstName = boards.find((b) => b.id === channel.boardIds![0])?.name
  if (firstName) return `${firstName} + ${channel.boardIds.length - 1} more`
  return `${channel.boardIds.length} boards`
}

const TABLE_GRID_BASE = 'grid-cols-[minmax(0,1fr)'
function tableGrid(eventCount: number) {
  return `${TABLE_GRID_BASE}${'_5rem'.repeat(eventCount)}]`
}
```

The grid is dynamic now — Slack has 4 events, Discord has 3. The fixed `_5rem_5rem_5rem_5rem` from the Slack file becomes a function of event count.

- [ ] **Step 2: Port `ChannelPicker`**

Replace the stub. Copy verbatim from `slack-config.tsx:156-266` (function `ChannelPicker`), but:

- Make it generic: `function ChannelPicker<TChannel extends Channel>(props: { channels: TChannel[]; value: string; onSelect: (id: string) => void; loading?: boolean; onRefresh?: () => void; renderChannelIcon: (c: TChannel | undefined) => ReactNode; placeholder?: string })`.
- Replace `<ChannelIcon isPrivate={selected.isPrivate} />` and `<ChannelIcon isPrivate={channel.isPrivate} />` with `{props.renderChannelIcon(selected)}` and `{props.renderChannelIcon(channel)}`.
- Drop the local `ChannelIcon` helper — caller provides the renderer.

- [ ] **Step 3: Port `BoardFilterPills`**

Copy verbatim from `slack-config.tsx:272-350`. No parameter changes needed — already takes `boards` as a prop. Just paste it in.

- [ ] **Step 4: Port `ChannelRow`**

Copy from `slack-config.tsx:356-516`. Changes:

- Add `events: EventConfig[]` and `renderChannelIcon: (c: TChannel | undefined) => ReactNode` to the props.
- Replace `SLACK_EVENT_CONFIG` references with `events` (the prop).
- Replace `<ChannelIcon isPrivate={isPrivate} />` with `{renderChannelIcon(channelInfo)}`.
- Drop the `isPrivate` derivation — the caller's renderer handles privacy.
- Replace `TABLE_GRID` constant references with `tableGrid(events.length)`.

- [ ] **Step 5: Port `RoutingTable`**

Replace the stub. Copy from `slack-config.tsx:522-588`. Changes:

- Add `events: EventConfig[]`, `renderChannelIcon`, generic `<TChannel extends Channel>` to props.
- Replace `SLACK_EVENT_CONFIG.map(...)` for headers with `events.map(...)`.
- Replace `TABLE_GRID` with `tableGrid(events.length)`.
- Pass `events` and `renderChannelIcon` down to `ChannelRow`.

- [ ] **Step 6: Port `AddChannelDialog`**

Replace the stub. Copy from `slack-config.tsx:594-787`. Changes:

- Add `events: EventConfig[]`, `renderChannelIcon`, generic `<TChannel extends Channel>` to props.
- Replace `SLACK_EVENT_CONFIG` references with `events`.
- Replace `<ChannelPicker>` instantiation with the generic version, passing `renderChannelIcon`.
- The dialog description currently reads "Route events to a Slack channel." Change to "Route events to a channel."

- [ ] **Step 7: Run typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 8: Run lint**

Run: `bun run lint`
Expected: passes.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/admin/settings/integrations/shared/notification-channel-router.tsx
git commit -m "feat(integrations): port routing-table internals into NotificationChannelRouter"
```

---

### Task 1.3: Refactor slack-config.tsx to consume the shared component

**Files:**

- Modify: `apps/web/src/components/admin/settings/integrations/slack/slack-config.tsx`

- [ ] **Step 1: Add imports for the shared component**

At the top of `slack-config.tsx`, add:

```tsx
import {
  NotificationChannelRouter,
  type NotificationChannel as SharedNotificationChannel,
} from '@/components/admin/settings/integrations/shared/notification-channel-router'
import { HashtagIcon, LockClosedIcon } from '@heroicons/react/24/solid'
```

- [ ] **Step 2: Delete extracted internals from slack-config.tsx**

Remove from `slack-config.tsx`:

- `function ChannelIcon` (lines ~109-112)
- `function getBoardSummary` (lines ~114-126)
- `function ChannelPicker` (lines ~156-266)
- `function BoardFilterPills` (lines ~272-350)
- `function ChannelRow` (lines ~356-516)
- `function RoutingTable` (lines ~522-588)
- `function AddChannelDialog` (lines ~594-787)
- The `TABLE_GRID` constant (line ~103)
- The local `interface NotificationChannel` (lines ~49-53) — replace with re-export from shared module if used in this file's exported types, otherwise drop
- Unused imports (e.g., `Popover`, `MagnifyingGlassIcon`, `ChevronUpDownIcon`, `ChevronRightIcon`) once the internals are gone — let `bun run lint` flag them

Keep:

- `useAddNotificationChannel` / `useUpdateNotificationChannel` / `useRemoveNotificationChannel` are no longer needed in this file (the shared component owns them) — remove those imports.
- `useAddMonitoredChannel` / `useUpdateMonitoredChannel` / `useRemoveMonitoredChannel` stay (Slack-only).
- Everything related to monitored channels: `MonitoredChannel` type, `MonitoredChannelRow`, `AddMonitoredChannelDialog`, the monitoring section of `SlackConfig`.
- `SLACK_EVENT_CONFIG` stays here (Slack-specific event list).
- `useSlackChannels` stays here.
- The legacy fallback synth in `SlackConfig` (lines ~1043-1056) stays.

- [ ] **Step 3: Replace the routing UI in `SlackConfig` with `<NotificationChannelRouter>`**

Find the Notification Routing section in `SlackConfig` (lines ~1093-1130). Replace the conditional `<RoutingTable>` / empty-state block with:

```tsx
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
```

The "Notification routing" `Label` heading and description above it stay. The empty state inside the conditional moves into the shared component, so that branch is now unconditional.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: passes. Fix any unused-import errors by deleting them.

- [ ] **Step 5: Run lint**

Run: `bun run lint`
Expected: passes.

- [ ] **Step 6: Manual smoke test the Slack settings page**

Run the dev server: `bun run dev`

In the browser at `/admin/settings/integrations/slack` (assuming Slack is connected in the seeded data):

- Open the page — routing table renders.
- Expand a channel row — board filter pills render, "Remove channel" button visible.
- Toggle a board pill — saves silently (network tab shows `updateNotificationChannelFn` 200).
- Click "Add channel" — dialog opens, channel picker works, search works, board filter section toggles.
- Save a new channel — table re-renders with the new row.
- Remove a channel via expanded row → confirmation dialog → confirm — row disappears.

If anything looks visually different from `main`, stop and inspect — the goal is zero UX change.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/admin/settings/integrations/slack/slack-config.tsx
git commit -m "refactor(integrations): consume NotificationChannelRouter from slack-config"
```

---

### Task 1.4: Open PR1

- [ ] **Step 1: Push the branch and open the PR**

```bash
git push -u origin HEAD
gh pr create --title "refactor(integrations): extract NotificationChannelRouter (#145 PR1/2)" --body "$(cat <<'EOF'
## Summary
- Extracts the routing-table UI from `slack-config.tsx` into a chat-scoped shared component at `components/admin/settings/integrations/shared/notification-channel-router.tsx`.
- Refactors Slack to consume it. Zero UX change.

This is PR1 of 2 for #145 (Discord per-board channels). PR2 wires Discord through this shared component and adds a one-time data-cleanup migration.

Spec: `docs/superpowers/specs/2026-04-30-discord-per-board-channels-design.md`

## Test plan
- [ ] `bun run typecheck` clean
- [ ] `bun run lint` clean
- [ ] Slack settings page: add channel, toggle event, set board filter, remove channel — visually identical to main
EOF
)"
```

---

## CHECKPOINT 1 — PR1 review and merge

**Do not proceed to Phase 2 until PR1 is merged.**

PR2 builds on the merged shared component. Starting Phase 2 before PR1 lands creates rebase pain and muddies the bisect surface for any regression.

When PR1 is merged:

```bash
git checkout main
git pull origin main
git checkout -b discord-per-board-pr2
```

---

## Phase 2 — PR2: Discord per-board + migration

### Task 2.1: Write the data-cleanup migration

**Files:**

- Create: `packages/db/drizzle/0048_consolidate_chat_target_keys.sql`

- [ ] **Step 1: Verify the next migration number**

Run: `ls packages/db/drizzle/*.sql | tail -3`
Expected: latest is `0047_*.sql`. The new migration is `0048_*`.

If a higher number exists, bump accordingly.

- [ ] **Step 2: Create the migration**

Create `packages/db/drizzle/0048_consolidate_chat_target_keys.sql`:

```sql
-- Consolidate target_key='default' rows for chat integrations.
--
-- Migration 0021 backfilled target_key + action_config.channelId from the
-- integration-level config.channelId. But the legacy updateIntegrationFn
-- omits targetKey on insert, so each event toggle since 0021 ran has
-- created a fresh target_key='default' row for chat integrations,
-- producing duplicates that runtime dedupe collapses but that pollute
-- the table.
--
-- This migration:
--   1. Drops 'default' rows when a real-channel row already exists for
--      the same (integration_id, event_type, action_type) triple.
--   2. Backfills any remaining standalone 'default' rows for chat
--      integrations whose config.channelId is set (same logic as 0021).
--
-- Scope is narrowed to chat integrations (slack, discord, teams). PM
-- integrations (jira, linear, asana, etc.) legitimately use
-- target_key='default' and are left alone.

DELETE FROM integration_event_mappings iem
WHERE iem.target_key = 'default'
  AND iem.integration_id IN (
    SELECT id FROM integrations
    WHERE integration_type IN ('slack', 'discord', 'teams')
  )
  AND EXISTS (
    SELECT 1 FROM integration_event_mappings other
    WHERE other.integration_id = iem.integration_id
      AND other.event_type = iem.event_type
      AND other.action_type = iem.action_type
      AND other.target_key <> 'default'
  );

UPDATE integration_event_mappings iem
SET target_key = (i.config->>'channelId'),
    action_config = jsonb_set(
      COALESCE(iem.action_config, '{}'),
      '{channelId}',
      to_jsonb(i.config->>'channelId')
    )
FROM integrations i
WHERE iem.integration_id = i.id
  AND i.integration_type IN ('slack', 'discord', 'teams')
  AND i.config->>'channelId' IS NOT NULL
  AND iem.target_key = 'default';
```

- [ ] **Step 3: Update the drizzle journal**

Drizzle tracks migrations in `packages/db/drizzle/meta/_journal.json`. Open it and append a new entry to the `entries` array, matching the surrounding format. The `idx` field should equal the migration number, `tag` is the filename without the `.sql` extension, and `when` is `Date.now()`.

Example to mimic (adjust `idx`, `when`, and `tag` to match your file):

```json
{
  "idx": 48,
  "version": "7",
  "when": <epoch_ms>,
  "tag": "0048_consolidate_chat_target_keys",
  "breakpoints": true
}
```

- [ ] **Step 4: Apply the migration locally**

Run: `bun run db:migrate`
Expected: drizzle reports the new migration applied. No errors.

- [ ] **Step 5: Verify the migration's effect**

Connect to the local Postgres (whatever method the project uses — `psql`, drizzle-kit studio, etc.) and check:

```sql
-- Should be 0 if migration ran cleanly: any 'default' row where a
-- real-channel row exists for the same event on a chat integration.
SELECT COUNT(*)
FROM integration_event_mappings iem
JOIN integrations i ON i.id = iem.integration_id
WHERE iem.target_key = 'default'
  AND i.integration_type IN ('slack', 'discord', 'teams')
  AND EXISTS (
    SELECT 1 FROM integration_event_mappings other
    WHERE other.integration_id = iem.integration_id
      AND other.event_type = iem.event_type
      AND other.action_type = iem.action_type
      AND other.target_key <> 'default'
  );
```

Expected: `count = 0`.

```sql
-- Should be 0: chat integration with config.channelId set but a
-- 'default' mapping that wasn't backfilled.
SELECT COUNT(*)
FROM integration_event_mappings iem
JOIN integrations i ON i.id = iem.integration_id
WHERE iem.target_key = 'default'
  AND i.integration_type IN ('slack', 'discord', 'teams')
  AND i.config->>'channelId' IS NOT NULL;
```

Expected: `count = 0`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/drizzle/0048_consolidate_chat_target_keys.sql packages/db/drizzle/meta/_journal.json
git commit -m "feat(db): consolidate chat-integration target_key='default' rows"
```

---

### Task 2.2: Add useDiscordChannels hook

**Files:**

- Modify: `apps/web/src/components/admin/settings/integrations/discord/discord-config.tsx`

- [ ] **Step 1: Add the hook above the component**

In `discord-config.tsx`, replace the existing `fetchChannels`/`useEffect` channel-loading code inside the component with a top-level hook. Add this above the `DiscordConfig` function:

```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query'

function useDiscordChannels() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['discord-channels'],
    queryFn: () => fetchDiscordChannelsFn(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  })

  const refresh = () => {
    queryClient.fetchQuery({
      queryKey: ['discord-channels'],
      queryFn: () => fetchDiscordChannelsFn(),
    })
  }

  return {
    channels: query.data ?? [],
    loading: query.isLoading || query.isFetching,
    error: query.isError ? 'Failed to load channels. Please try again.' : null,
    refresh,
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: passes (the hook is unused but valid; we'll use it in Task 2.3).

- [ ] **Step 3: Don't commit yet** — Task 2.3 modifies the same file. Combined commit at end of 2.3.

---

### Task 2.3: Replace DiscordConfig body with NotificationChannelRouter

**Files:**

- Modify: `apps/web/src/components/admin/settings/integrations/discord/discord-config.tsx`

- [ ] **Step 1: Update the props interface**

Replace the `DiscordConfigProps` interface near the top of the file:

```tsx
interface DiscordConfigProps {
  integrationId: string
  initialConfig: { channelId?: string }
  initialEventMappings: { id: string; eventType: string; enabled: boolean }[]
  notificationChannels?: NotificationChannel[]
  enabled: boolean
}
```

The `notificationChannels` prop is new; the rest are unchanged.

- [ ] **Step 2: Add imports**

Add to the top of the file:

```tsx
import { HashtagIcon } from '@heroicons/react/24/solid'
import {
  NotificationChannelRouter,
  type NotificationChannel,
  type EventConfig,
} from '@/components/admin/settings/integrations/shared/notification-channel-router'
import { useQuery as useBoardsQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
```

(If `useQuery` is already imported from Task 2.2, alias the new import or just reuse — don't duplicate.)

- [ ] **Step 3: Define DISCORD_EVENT_CONFIG**

Replace the existing `EVENT_CONFIG` constant with:

```tsx
const DISCORD_EVENT_CONFIG: EventConfig[] = [
  {
    id: 'post.created',
    label: 'New feedback submitted',
    shortLabel: 'Feedback',
    description: 'When a user submits new feedback',
  },
  {
    id: 'post.status_changed',
    label: 'Feedback status changed',
    shortLabel: 'Status',
    description: 'When the status of a feedback post is updated',
  },
  {
    id: 'comment.created',
    label: 'New comment on feedback',
    shortLabel: 'Comment',
    description: 'When someone comments on a feedback post',
  },
]
```

Note: only 3 events. No `changelog.published` — that's a deliberate omission; adding it is a separate decision per the spec.

- [ ] **Step 4: Replace the component body**

Replace the entire `DiscordConfig` function with:

```tsx
export function DiscordConfig({
  integrationId,
  initialConfig,
  initialEventMappings,
  notificationChannels: initialChannels,
  enabled,
}: DiscordConfigProps) {
  const updateMutation = useUpdateIntegration()
  const {
    channels,
    loading: loadingChannels,
    error: channelError,
    refresh: refreshChannels,
  } = useDiscordChannels()
  const boardsQuery = useBoardsQuery(adminQueries.boards())
  const boards = (boardsQuery.data ?? []).map((b) => ({ id: b.id, name: b.name }))
  const [integrationEnabled, setIntegrationEnabled] = useState(enabled)

  // Use notificationChannels if available; otherwise synthesize from legacy
  // single-channel config so the user can keep editing without re-adding.
  const notificationChannels: NotificationChannel[] = initialChannels?.length
    ? initialChannels
    : initialConfig.channelId
      ? [
          {
            channelId: initialConfig.channelId,
            events: DISCORD_EVENT_CONFIG.map((e) => ({
              eventType: e.id,
              enabled: initialEventMappings.find((m) => m.eventType === e.id)?.enabled ?? false,
            })),
            boardIds: null,
          },
        ]
      : []

  const handleEnabledChange = (checked: boolean) => {
    setIntegrationEnabled(checked)
    updateMutation.mutate({ id: integrationId, enabled: checked })
  }

  const saving = updateMutation.isPending

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="enabled-toggle" className="text-base font-medium">
            Notifications enabled
          </Label>
          <p className="text-sm text-muted-foreground">
            Turn off to pause all Discord notifications
          </p>
        </div>
        <Switch
          id="enabled-toggle"
          checked={integrationEnabled}
          onCheckedChange={handleEnabledChange}
          disabled={saving}
        />
      </div>

      <div className="border-t border-border/30" />

      <div className="space-y-3">
        <div>
          <Label className="text-base font-medium">Notification routing</Label>
          <p className="text-sm text-muted-foreground">
            Choose which events reach each Discord channel
          </p>
        </div>

        <NotificationChannelRouter<DiscordChannel>
          integrationId={integrationId}
          enabled={integrationEnabled}
          events={DISCORD_EVENT_CONFIG}
          channels={channels}
          notificationChannels={notificationChannels}
          boards={boards}
          loadingChannels={loadingChannels}
          channelError={channelError}
          onRefreshChannels={refreshChannels}
          renderChannelIcon={() => <HashtagIcon className="h-3.5 w-3.5 text-muted-foreground" />}
        />
      </div>

      {saving && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}

      {updateMutation.isError && (
        <div className="text-sm text-destructive">
          {updateMutation.error?.message || 'Failed to save changes'}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Delete unused imports**

Remove from `discord-config.tsx` (now unused after the rewrite):

- `useEffect`, `useCallback` from React
- `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` from shadcn
- `Button` (likely unused now)
- `EVENT_CONFIG` constant — replaced by `DISCORD_EVENT_CONFIG`

Let `bun run lint` flag anything missed.

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 7: Run lint**

Run: `bun run lint`
Expected: passes.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/admin/settings/integrations/discord/discord-config.tsx
git commit -m "feat(integrations): wire Discord to NotificationChannelRouter"
```

---

### Task 2.4: Pass notificationChannels through the Discord route

**Files:**

- Modify: `apps/web/src/routes/admin/settings/integrations/discord.tsx`

- [ ] **Step 1: Update the JSX prop wiring**

Open `apps/web/src/routes/admin/settings/integrations/discord.tsx`. Find the `<DiscordConfig>` element (around line 55) and add `notificationChannels`:

```tsx
<DiscordConfig
  integrationId={integration.id}
  initialConfig={integration.config}
  initialEventMappings={integration.eventMappings}
  notificationChannels={integration.notificationChannels}
  enabled={integration.status === 'active'}
/>
```

(Verify the `enabled` prop name matches the actual existing code — it may be passed differently. The change is only to add the new line.)

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: passes. The loader (`fetchIntegrationByType`) already returns `notificationChannels` for any integration type, so the prop is available without further loader changes.

- [ ] **Step 3: Manual smoke test**

Run: `bun run dev`

At `/admin/settings/integrations/discord` (Discord must be connected in seeded data; if not, connect it first via the OAuth flow):

- Page renders.
- If Discord has a `config.channelId` set: routing table shows one row with the existing channel, all current events reflected.
- If no channel set: empty state with "Add your first channel" button.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/admin/settings/integrations/discord.tsx
git commit -m "feat(integrations): pass notificationChannels to DiscordConfig"
```

---

### Task 2.5: Write routing E2E specs (Discord + Slack)

**Files:**

- Create: `apps/web/e2e/tests/admin/integrations-discord-routing.spec.ts`
- Create: `apps/web/e2e/tests/admin/integrations-slack-routing.spec.ts`

**Why both:** The shared `NotificationChannelRouter` introduced in PR1 had zero direct test coverage. Writing parallel specs for both consumers exercises the generic `<TChannel extends Channel>` shape with two different channel types and confirms the per-consumer event lists differ correctly (Discord: 3 events, no Changelog; Slack: 4 events including Changelog, plus public/private icon variation).

- [ ] **Step 1: Inspect existing E2E patterns**

Read `apps/web/e2e/tests/admin/notifications.spec.ts` (or another spec in that directory) to understand:

- How tests authenticate / what `beforeEach` setup looks like.
- How the test fixtures and helpers are imported (`@playwright/test`, project helpers, etc.).
- The base URL convention.

This determines the imports and fixtures used in both specs below — adapt to match the project's existing pattern.

- [ ] **Step 2: Create the Discord routing spec**

Create `apps/web/e2e/tests/admin/integrations-discord-routing.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test.describe('Discord notification routing', () => {
  test.beforeEach(async ({ page }) => {
    // Adapt to project auth helper. Common pattern in this repo:
    // login as demo@example.com via the seeded session, then navigate.
    await page.goto('/admin/settings/integrations/discord')
  })

  test('renders the routing UI when Discord is connected', async ({ page }) => {
    // Either the empty state or the routing table is visible.
    const hasTable = await page.getByRole('button', { name: /add channel/i }).isVisible()
    const hasEmptyState = await page
      .getByText(/no notification channels configured yet/i)
      .isVisible()
    expect(hasTable || hasEmptyState).toBe(true)
  })

  test('add channel dialog opens and closes', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /add (your first )?channel/i }).first()
    await addBtn.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText(/route events to a channel/i)).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('exposes board filter in add dialog', async ({ page }) => {
    await page
      .getByRole('button', { name: /add (your first )?channel/i })
      .first()
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    // Board filter is collapsed by default; clicking expands it.
    await page.getByRole('button', { name: /filter by board/i }).click()
    await expect(page.getByText(/board filter/i)).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).click()
  })

  test('event columns reflect Discord event list (3 events, no changelog)', async ({ page }) => {
    // Skip if no rows are configured; the column headers only appear in the table.
    const tableHeader = page.getByText(/^Channel$/)
    if (await tableHeader.isVisible()) {
      await expect(page.getByText(/^Feedback$/)).toBeVisible()
      await expect(page.getByText(/^Status$/)).toBeVisible()
      await expect(page.getByText(/^Comment$/)).toBeVisible()
      // Slack has Changelog; Discord must not.
      await expect(page.getByText(/^Changelog$/)).not.toBeVisible()
    }
  })
})
```

These tests cover the structural surface — empty state vs routing table render, add-channel dialog open/close, board filter accessibility, and Discord-specific event-list (3 events, no Changelog). They don't drive a full add-channel flow because that requires Discord channel data which depends on environment seeding.

- [ ] **Step 3: Create the Slack routing spec**

Create `apps/web/e2e/tests/admin/integrations-slack-routing.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test.describe('Slack notification routing', () => {
  test.beforeEach(async ({ page }) => {
    // Same auth pattern as the Discord sibling.
    await page.goto('/admin/settings/integrations/slack')
  })

  test('renders the routing UI when Slack is connected', async ({ page }) => {
    const hasTable = await page.getByRole('button', { name: /add channel/i }).isVisible()
    const hasEmptyState = await page
      .getByText(/no notification channels configured yet/i)
      .isVisible()
    expect(hasTable || hasEmptyState).toBe(true)
  })

  test('add channel dialog opens and closes', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /add (your first )?channel/i }).first()
    await addBtn.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    // Same shared component renders the same dialog title and description for Slack.
    await expect(page.getByText(/route events to a channel/i)).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('exposes board filter in add dialog', async ({ page }) => {
    await page
      .getByRole('button', { name: /add (your first )?channel/i })
      .first()
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: /filter by board/i }).click()
    await expect(page.getByText(/board filter/i)).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).click()
  })

  test('event columns reflect Slack event list (4 events including Changelog)', async ({
    page,
  }) => {
    const tableHeader = page.getByText(/^Channel$/)
    if (await tableHeader.isVisible()) {
      await expect(page.getByText(/^Feedback$/)).toBeVisible()
      await expect(page.getByText(/^Status$/)).toBeVisible()
      await expect(page.getByText(/^Comment$/)).toBeVisible()
      // Slack-only event — must be present (mirrors the negative assertion in the Discord spec).
      await expect(page.getByText(/^Changelog$/)).toBeVisible()
    }
  })

  test('channel monitoring section still renders', async ({ page }) => {
    // PR1 left the monitored-channel UI unchanged. This guards against the
    // refactor accidentally removing it.
    await expect(page.getByText(/channel monitoring/i)).toBeVisible()
  })
})
```

The 4-events-including-Changelog assertion is the symmetric proof against the Discord spec's 3-events-no-Changelog assertion. Together they prove the shared component's `events` prop is wired correctly through both consumers. The "channel monitoring section still renders" test is a small safety net — it would catch a refactor that accidentally deleted the Slack-only monitoring UI.

- [ ] **Step 4: Run both new specs**

Run: `bun run test:e2e --grep "(Discord|Slack) notification routing"`
(Or whatever the project's E2E command is — check the root `package.json` if unsure.)
Expected: passes. If the test environment doesn't have one of the integrations connected, the table-conditional tests skip naturally via the `if (await tableHeader.isVisible())` guards. The structural assertions (page renders, dialog opens, etc.) still cover what they can.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/tests/admin/integrations-discord-routing.spec.ts apps/web/e2e/tests/admin/integrations-slack-routing.spec.ts
git commit -m "test(integrations): e2e for chat-routing UI (Discord + Slack)"
```

---

### Task 2.6: Final verification

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 2: Run lint**

Run: `bun run lint`
Expected: passes.

- [ ] **Step 3: Run unit/integration tests**

Run: `bun run test`
Expected: passes. No new unit tests are required; backend logic is untouched.

- [ ] **Step 4: Run full E2E suite**

Run: `bun run test:e2e`
Expected: passes. The existing Discord smoke reference in `getting-started.spec.ts:41` (which only checks the literal string "Connect GitHub, Slack, or Discord") is unaffected. The new spec runs alongside.

- [ ] **Step 5: Manual smoke test, full flow**

Run: `bun run dev`

At `/admin/settings/integrations/discord` (Discord must be connected):

- Routing table renders with the existing single channel as one row (legacy fallback or post-migration data).
- Click "Add channel" → pick a channel → select events → add board filter → save. New row appears.
- Expand the new row, change board filter pills, watch network for `updateNotificationChannelFn` 200.
- Toggle event checkboxes on the row, watch network for updates.
- Remove the new row via the expanded "Remove channel" button. Row disappears.
- Toggle the integration enable/disable switch — disables interaction with the routing table.

If anything fails, debug before opening the PR.

---

### Task 2.7: Open PR2

- [ ] **Step 1: Push the branch and open the PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(integrations): per-board Discord channels (#145 PR2/2)" --body "$(cat <<'EOF'
## Summary
- Wires Discord's settings UI to the shared `NotificationChannelRouter` (added in PR1).
- Adds migration `0048_consolidate_chat_target_keys.sql` to clean up duplicate `target_key='default'` rows produced by the legacy update path on chat integrations.
- Deletes the legacy single-channel Discord form.

Closes #145.

Spec: `docs/superpowers/specs/2026-04-30-discord-per-board-channels-design.md`

## Test plan
- [ ] `bun run typecheck` clean
- [ ] `bun run lint` clean
- [ ] `bun run test` clean
- [ ] `bun run test:e2e` clean (new `integrations-discord-routing.spec.ts` and `integrations-slack-routing.spec.ts` pass)
- [ ] Manual: add a Discord notification channel, set board filter, toggle events, remove channel
- [ ] Manual: legacy fallback — existing Discord install with one configured channel renders as one row in the new UI without action

## Migration
- Drops `target_key='default'` rows where a real-channel row already exists for the same `(integration_id, event_type, action_type)` triple on chat integrations.
- Backfills any remaining 'default' rows for chat integrations whose `config.channelId` is set.
- PM integrations untouched.
EOF
)"
```

---

## Self-review

**Spec coverage:**

- D1 (extract scoped) → Task 1.1 docstring + Task 1.2 generic component.
- D2 (legacy fallback synth) → Task 2.3 step 4 (synth block).
- D3 (no flag) → no task; absence is the implementation.
- D4 (two PRs) → Phase 1 / Phase 2 split with hard checkpoint.
- Migration step 1 (delete duplicates) → Task 2.1 step 2.
- Migration step 2 (backfill remaining) → Task 2.1 step 2.
- Discord route loader pass-through → Task 2.4.
- Discord legacy-fallback synth → Task 2.3 step 4.
- E2E coverage (Discord + Slack) → Task 2.5.
- Slack parity gate → Task 1.3 step 6 (manual smoke).

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / "appropriate error handling" patterns. Code blocks include the actual code where applicable; ports reference exact line ranges in `slack-config.tsx` rather than restating ~600 LOC verbatim — acceptable for a refactor task.

**Type consistency:**

- `NotificationChannel.channelId: string`, `events: { eventType; enabled }[]`, `boardIds: string[] | null` — used consistently across the shared component, Slack, and Discord.
- `EventConfig.id` is `string` everywhere it appears.
- `Channel` is `{ id; name }`; both `SlackChannel` and `DiscordChannel` extend it via the generic constraint.
- `renderChannelIcon` signature `(channel: TChannel | undefined) => ReactNode` matches across the public API and internal `RoutingTable` / `ChannelRow` / `AddChannelDialog`.
