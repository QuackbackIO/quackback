# Discord per-board channels — design

**Issue:** [QuackbackIO/quackback#145](https://github.com/QuackbackIO/quackback/issues/145)

**Status:** approved, ready for plan

## Summary

Bring Discord's notification config to feature parity with Slack: per-channel routing with optional per-board filters. Backend already supports this for any integration; only Discord's UI is the legacy single-channel form.

The work splits into two PRs:

1. **PR1** — extract a shared `NotificationChannelRouter` component, refactor Slack to consume it. Zero UX change for Slack; pure refactor.
2. **PR2** — wire Discord's route loader and config component to use the shared component. Add a one-time data-cleanup migration. Delete the legacy single-channel form.

## What already works (no changes)

- `integration_event_mappings.filters` (jsonb) stores `{ boardIds: string[] }` per mapping.
- `getIntegrationTargets` in `apps/web/src/lib/server/events/targets.ts:186-194` filters mappings by `boardIds` for any integration type.
- `addNotificationChannelFn` / `updateNotificationChannelFn` / `removeNotificationChannelFn` in `apps/web/src/lib/server/functions/integrations.ts` accept `boardIds` and key off `integrationId` — fully reusable for Discord.
- `fetchIntegrationByType` in `apps/web/src/lib/server/functions/admin.ts:423-459` returns `notificationChannels` for any integration, including Discord.
- The Discord hook handler (`apps/web/src/lib/server/integrations/discord/hook.ts`) reads `channelId` from `target` — multi-mapping fan-out delivers correctly with no changes.
- Migration 0021 already backfilled `target_key` and `action_config.channelId` from integration-level `config.channelId` for all integrations.

## What's missing

1. `apps/web/src/routes/admin/settings/integrations/discord.tsx:55` doesn't pass `notificationChannels` to `<DiscordConfig>`.
2. `apps/web/src/components/admin/settings/integrations/discord/discord-config.tsx` is the legacy single-channel UI: one `<Select>` for channel, three event toggles. No board filter, no multi-channel.
3. `slack-config.tsx` (1242 LOC) embeds the routing-table UI in-file. Copying it for Discord would duplicate ~600 LOC.

## Decisions

|     | Decision                                                                                     | Rationale                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Extract shared component, scoped to chat-style integrations                                  | Avoid copy-paste at N=2; Teams is the obvious next consumer; PM integrations don't fit this pattern and shouldn't share it                                     |
| D2  | Synthesize one `NotificationChannel` from `initialConfig.channelId` when loader returns none | Mirrors Slack's pattern (`slack-config.tsx:1043-1056`); handles "channel set, no event toggles yet" UX; migration covers data debt separately                  |
| D3  | No feature flag                                                                              | Slack didn't gate it; backend is exercised in prod; change is purely additive                                                                                  |
| D4  | Two PRs — refactor first, feature second                                                     | PR1 is mechanically simple but touches a 1242-line file; reviewable as pure refactor with E2E parity. PR2 is the user-facing change. Bisectable on regression. |

## Architecture

### Shared component

**File:** `apps/web/src/components/admin/settings/integrations/shared/notification-channel-router.tsx`

**Top-of-file docstring:**

> Routing UI for chat-style integrations — pick a destination channel per event with optional board filter. Not for ticket-creation integrations (Jira, Linear, etc.) or broadcast/digest integrations.

**Public component:** `NotificationChannelRouter`

**Internal components** (not exported): `RoutingTable`, `ChannelRow`, `BoardFilterPills`, `AddChannelDialog`, `ChannelPicker`.

**Props:**

```ts
type Channel = { id: string; name: string }

type NotificationChannel = {
  channelId: string
  events: { eventType: string; enabled: boolean }[]
  boardIds: string[] | null
}

type Props<TChannel extends Channel> = {
  integrationId: string
  enabled: boolean
  events: { id: string; label: string; shortLabel: string; description: string }[]
  channels: TChannel[]
  notificationChannels: NotificationChannel[]
  boards: { id: string; name: string }[]
  loadingChannels: boolean
  channelError: string | null
  onRefreshChannels: () => void
  renderChannelIcon?: (channel: TChannel) => ReactNode
}
```

Mutation hooks (`useAddNotificationChannel`, `useUpdateNotificationChannel`, `useRemoveNotificationChannel`) are integration-agnostic and used directly.

### What stays per-integration

**Slack-only** (in `slack-config.tsx`):

- `useSlackChannels` (Slack-specific cache key + fetch fn).
- `MonitoredChannelRow`, `AddMonitoredChannelDialog` (channel monitoring with AI screening).
- Monitoring-scopes check (`channels:history`).
- Public/private channel icon renderer (passed as `renderChannelIcon` prop).
- `SLACK_EVENT_CONFIG` (4 events including `changelog.published`).

**Discord-only** (in `discord-config.tsx`):

- `useDiscordChannels` (mirrors `useSlackChannels` pattern).
- Hashtag icon renderer (passed as `renderChannelIcon`).
- `DISCORD_EVENT_CONFIG` (3 events: `post.created`, `post.status_changed`, `comment.created`). No `changelog.published` — keep parity with Discord's existing event list.

## PR1 — Extract + Slack refactor

**New files:**

- `apps/web/src/components/admin/settings/integrations/shared/notification-channel-router.tsx`

**Modified:**

- `apps/web/src/components/admin/settings/integrations/slack/slack-config.tsx`:
  - Delete: `RoutingTable`, `ChannelRow`, `BoardFilterPills`, `AddChannelDialog`, `ChannelPicker`, `getBoardSummary`, `ChannelIcon`, `TABLE_GRID`.
  - Keep: `useSlackChannels`, `MonitoredChannelRow`, `AddMonitoredChannelDialog`, scopes check, integration enable/disable toggle, legacy-fallback synth, `SLACK_EVENT_CONFIG`.
  - Render `<NotificationChannelRouter>` for the routing section.
  - Pass a `renderChannelIcon` rendering hash/lock for Slack public/private channels.

**Behavior:** zero UX change. Same DOM, same flows, same E2E pass.

**Diff size:** ~600 LOC moved into the new file. `slack-config.tsx` shrinks from ~1242 → ~700 LOC.

**Acceptance:**

- All existing Slack E2E tests pass without modification.
- Visual diff on the Slack settings page matches `main`.
- `bun run typecheck` and `bun run lint` clean.

## PR2 — Discord per-board

### Code changes

**Modified:**

- `apps/web/src/routes/admin/settings/integrations/discord.tsx`:
  - Pass `notificationChannels={integration.notificationChannels}` through to `<DiscordConfig>`. (Loader already returns this.)

- `apps/web/src/components/admin/settings/integrations/discord/discord-config.tsx`:
  - Replace body. New shape:
    - Integration enable/disable toggle (kept).
    - `<NotificationChannelRouter>` for routing.
  - Add `useDiscordChannels` hook (react-query, 5-min `staleTime`, refresh fn — mirrors `useSlackChannels`).
  - Define `DISCORD_EVENT_CONFIG` (the existing 3 events).
  - Pass `renderChannelIcon` for hashtag icon.
  - Legacy-fallback synth: identical pattern to `slack-config.tsx:1043-1056` — synthesize one `NotificationChannel` from `initialConfig.channelId` if `notificationChannels` is empty.
  - Delete the old single-channel `<Select>`, the per-event `<Switch>` list, the old `eventSettings` state, the `handleChannelChange`/`handleEventToggle` handlers.

- `apps/web/src/components/admin/settings/integrations/discord/discord-connection-actions.tsx`: unchanged.

### Data migration

`packages/db/drizzle/0048_consolidate_chat_target_keys.sql`:

```sql
-- Step 1: For chat integrations, drop 'default' rows when a real-channel row
-- exists for the same (integration_id, event_type, action_type) triple.
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

-- Step 2: Backfill any remaining 'default' rows for chat integrations
-- that have config.channelId set (same logic as 0021, catches rows
-- created since 0021 ran via the legacy updateIntegrationFn path).
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

**Scope:** narrowed to chat integrations. PM integrations (Jira, Linear, etc.) legitimately use `target_key='default'` — leave them alone.

**Why both steps:** step 1 handles duplicates created by the legacy bulk update path after 0021 ran; step 2 catches any standalone 'default' rows that 0021 missed (e.g., integration reconnected with a different channel).

### Existing-user behavior

- **Discord with one channel + 3 enabled events**: migration 0021 already moved data into routing-table shape; new migration normalizes any duplicates from subsequent toggles. Loader returns one `NotificationChannel` with that channelId and event mappings. Routing table renders one row, no filter. Identical delivery.
- **Discord connected, channel set, no events toggled yet**: legacy fallback synth renders one row with all events disabled, ready to toggle. First toggle creates real mapping rows via the new mutations.
- **Teams**: not in scope. Teams continues hitting `updateIntegrationFn` and creating new `target_key='default'` rows. Runtime dedupe keeps delivery correct. Will be cleaned up when Teams gets the same UI treatment (follow-up).

### Acceptance

New E2E spec `apps/web/e2e/tests/admin/integrations-discord-routing.spec.ts` covering:

- Add a Discord notification channel with all events selected.
- Toggle events on/off, assert mapping rows update.
- Set a board filter, assert `filters.boardIds` written.
- Remove the channel, assert mappings deleted.
- Legacy-fallback render: integration with `config.channelId` but no real-channel mapping rows — assert one synthesized row appears.

Existing Discord E2E (`getting-started.spec.ts` references) must pass unchanged.

## Risks

| Risk                                                                           | Mitigation                                                                                                |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Naming drift — someone fits Jira/Linear into `NotificationChannelRouter` later | Top-of-file docstring scopes the contract; PR description repeats it; reviewers enforce                   |
| Premature abstraction at N=2                                                   | Contract is well-defined; integrations that don't fit get their own UI (correct outcome, not failure)     |
| Slack regression from PR1 refactor                                             | Pure mechanical extraction; E2E parity is the gate; PR1 reverts cleanly                                   |
| Discord users with weird mapping state from legacy `updateIntegrationFn`       | Migration consolidates duplicates and backfills standalone 'default' rows                                 |
| Teams keeps polluting after PR2                                                | Acceptable — runtime dedupe keeps delivery correct; same migration logic cleans up when Teams is migrated |

## Future architecture notes (not in scope)

The work in #145 is a UI extraction with a small data-hygiene migration. The notification system has three larger architectural threads worth tracking as separate initiatives:

1. **Event catalog consolidation** — `lib/server/events/event-catalog.ts` as the single source of `{ id, label, shortLabel, description, supportedTargets }`. Today event labels are duplicated across `slack-config.tsx`, `discord-config.tsx`, email templates, webhook UI. Pays off when adding the next event type or Teams. File as follow-up issue, link from #145.

2. **Target-resolver registry** — `lib/server/events/targets.ts` (723 LOC) hand-rolls integration / subscriber / changelog / webhook / AI / summary resolution. Future shape: `getHookTargets` iterates a registry of `TargetResolver`s, each integration registers its own. Tackle when adding Teams. File as follow-up issue.

3. **Operational health** — per-integration delivery health, retry observability, token-expiry detection, queue depth, rate limiting. The hook handlers already return structured `HookResult`; what's missing is dashboards, alerting, and per-integration health records. Separate initiative; biggest scaling pain at customer-count > ~50.

The data model (`integration_event_mappings` with jsonb `filters` and `action_config`, polymorphic `actionType`) is forward-compatible with all three. This PR doesn't constrain them.

## Out of scope

- Adding `changelog.published` to Discord's event list.
- Adding new filter types (tags, status, upvote thresholds) — `filters` is jsonb so future-extensible.
- Teams refactor.
- PM-integration UI changes.
- Operational observability work.
- Refactoring `targets.ts` into a registry.
- Event catalog consolidation.
