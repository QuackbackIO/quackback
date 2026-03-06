# Slack Channel Monitoring

**Date:** 2026-03-06
**Branch:** `feat/slack-channel-monitoring`

## Summary

Allow admins to configure Slack channels that Quackback monitors automatically. Every message posted in a monitored channel is passed through an AI quality gate and, if it's genuine feedback, ingested as a raw feedback item through the existing pipeline -- no manual "Send to Quackback" shortcut needed.

## Architecture Decisions

### Push via Slack Events API

**Chosen:** Slack Events API (HTTP push) over polling `conversations.history`.

- Real-time ingestion (sub-second latency)
- No cron/BullMQ polling job, no cursor management, no API rate-limit pressure
- The app already has a public URL for `/api/integrations/slack/interact` so adding a second webhook is trivial
- Slack handles retries (3 attempts, exponential backoff) with `event_id` deduplication

### Two-tier ingestion: shortcut vs. channel monitor

"Send to Quackback" and channel monitoring are fundamentally different trust levels and should be treated differently in the pipeline.

|                   | Send to Quackback      | Channel Monitor                                              |
| ----------------- | ---------------------- | ------------------------------------------------------------ |
| **Trust**         | High -- human vetted   | Low -- unvetted                                              |
| **Title**         | Human-written          | AI-generated from message text                               |
| **Quality gate**  | Skipped (auto-pass)    | Required -- LLM classification                               |
| **Pipeline path** | Straight to extraction | Quality gate -> extraction (if passes) -> dismissed (if not) |
| **Failure mode**  | Rarely wrong           | Often noise                                                  |

The existing quality gate (`quality-gate.service.ts`) already has a tiered system:

1. Hard skip: < 5 words
2. Auto-pass: high-intent sources (`api`, `quackback`) with 15+ words
3. LLM gate: everything else via `buildQualityGatePrompt`

The `shouldExtract` function is called at the start of `extractSignals()`. Items that fail the gate are marked `completed` with no signals or suggestions -- they're effectively invisible to admins.

**What changes:** We extend this existing system rather than building a separate pipeline state:

1. Add `'slack_shortcut'` to `HIGH_INTENT_SOURCES` so the existing "Send to Quackback" flow auto-passes the gate (it currently hits the LLM gate since `sourceType` is `'slack'`)
2. Channel-monitored items arrive with `sourceType: 'slack'` and `contextEnvelope.metadata.ingestionMode: 'channel_monitor'` -- they always hit the LLM gate (tier 3)
3. Enhance the quality gate prompt with channel-monitor-specific guidance: "Messages from monitored Slack channels are passively collected. Be strict -- only extract if the message contains genuine product feedback, not casual conversation, coordination, or social chat."
4. When the gate rejects a channel-monitored item, mark it `dismissed` (new processing state) instead of `completed`, so admins can optionally audit what was filtered out
5. When the gate passes, it also returns a `suggestedTitle` since there's no human-provided title -- written into `content.subject` before extraction proceeds

### Cost profile

The quality gate is a single short prompt (~200 input tokens, ~50 output tokens) using the cheap flash-lite model. Full extraction is much heavier. For a noisy channel where 80% of messages aren't feedback, this saves significant extraction cost by filtering early.

## Scope

### In scope

- New DB table for monitored channel config
- New `POST /api/integrations/slack/events` endpoint (Events API receiver)
- Admin UI section in Slack settings to add/remove monitored channels
- Bot auto-joins monitored channels
- AI quality gate for channel-monitored messages (extend existing gate)
- New `dismissed` processing state for gate-rejected items
- `ingestionMode` metadata to distinguish shortcut vs. monitor in the pipeline
- Auto-pass shortcut items through the quality gate
- AI-generated titles for channel-monitored items (from quality gate response)
- Deduplication against existing raw items (same channel+ts won't be ingested twice even if also sent via the shortcut)
- Optional board targeting per monitored channel
- Slack user resolution through existing `resolveAuthorPrincipal` pipeline

### Out of scope (future)

- Thread reply ingestion (only top-level messages for now)
- Message edit/delete sync (we ingest the original, ignore edits)
- Keyword/regex filtering rules -- the AI quality gate handles this
- Backfill of historical messages when a channel is first added
- Socket Mode (we use HTTP Events API only)
- Admin UI to audit dismissed items (useful later, not needed for v1)

---

## Implementation Plan

### Phase 1: Database

#### New table: `slack_channel_monitors`

**File:** `packages/db/src/schema/integrations.ts`

| Column           | Type                     | Notes                                    |
| ---------------- | ------------------------ | ---------------------------------------- |
| `id`             | TypeID `slack_monitor_*` | PK                                       |
| `integration_id` | FK -> integrations       | CASCADE on delete                        |
| `channel_id`     | varchar(20)              | Slack channel ID (e.g. `C06ABCDEF`)      |
| `channel_name`   | text                     | Cached display name, refreshed on events |
| `board_id`       | FK -> boards, nullable   | Optional target board for ingested items |
| `enabled`        | boolean, default true    | Per-channel toggle                       |
| `created_at`     | timestamptz              |                                          |
| `updated_at`     | timestamptz              |                                          |

**Constraints:**

- `UNIQUE(integration_id, channel_id)` -- one config per channel
- FK to `integrations` with `ON DELETE CASCADE`
- FK to `boards` with `ON DELETE SET NULL`

**Index:**

- `idx_slack_monitors_lookup` on `(integration_id, channel_id, enabled)` -- hot path in event handler

#### New processing state: `dismissed`

**File:** `apps/web/src/lib/server/domains/feedback/types.ts`

Add `'dismissed'` to `RawFeedbackProcessingState`. This represents items that the quality gate determined are not actionable feedback. Distinct from `completed` (which means the pipeline finished normally, possibly with signals).

**Steps:**

1. Add table definition in `packages/db/src/schema/integrations.ts`
2. Register the TypeID prefix `slack_monitor` in `@quackback/ids`
3. Add Drizzle relations (integration -> many monitors, monitor -> one board)
4. Add `'dismissed'` to `RawFeedbackProcessingState`
5. Generate and run migration: `bun run db:generate && bun run db:migrate`

---

### Phase 2: OAuth Scope Update

**File:** `apps/web/src/lib/server/integrations/slack/oauth.ts`

Add two new scopes to `SLACK_SCOPES`:

```ts
const SLACK_SCOPES = [
  'channels:read',
  'groups:read',
  'channels:join',
  'channels:history', // NEW - receive message events from public channels
  'groups:history', // NEW - receive message events from private channels
  'chat:write',
  'team:read',
  'commands',
].join(',')
```

**Note:** Existing Slack connections will need to be reconnected (disconnect + connect) to pick up the new scopes. The UI should detect missing scopes from `integrations.config.scopes` and show a reconnect prompt.

---

### Phase 3: Quality Gate Enhancements

Extend the existing quality gate to handle the shortcut vs. monitor distinction.

#### 3a. Differentiate ingestion modes

**File:** `apps/web/src/lib/server/domains/feedback/pipeline/quality-gate.service.ts`

The `shouldExtract` function receives `sourceType` and `context` (which contains `metadata.ingestionMode`). Changes:

```
1. Add 'slack_shortcut' to HIGH_INTENT_SOURCES (or check ingestionMode directly):
   - If sourceType === 'slack' && metadata.ingestionMode !== 'channel_monitor'
     -> auto-pass (human-curated, high trust)

2. If ingestionMode === 'channel_monitor':
   - Always go to tier 3 (LLM gate) regardless of word count
   - Use a stricter prompt variant (see 3b)
```

#### 3b. Enhanced quality gate prompt for channel monitors

**File:** `apps/web/src/lib/server/domains/feedback/pipeline/prompts/quality-gate.prompt.ts`

Add channel-monitor-specific context to `buildQualityGatePrompt`:

```
Source type "slack" with channel monitoring context:
- These messages are passively collected from a monitored Slack channel
- Be STRICT: most messages will be casual conversation, not feedback
- Only extract if the message contains genuine product feedback:
  bug reports, feature requests, complaints, usability issues, or praise
- Reject: greetings, coordination, meeting scheduling, social chat,
  reactions to other messages, questions about how to do something,
  status updates, links without commentary
```

#### 3c. AI-generated title for channel-monitored items

Extend the quality gate response schema for channel-monitored items:

```json
{
  "extract": true,
  "reason": "contains a feature request for dark mode",
  "suggestedTitle": "Request for dark mode support"
}
```

When the gate passes for a `channel_monitor` item, `extractSignals()` writes `suggestedTitle` into `content.subject` before proceeding with extraction. This replaces the truncated-first-120-chars approach in the event handler -- the event handler sets `content.subject` to an empty string or the raw text, and the quality gate provides the real title.

#### 3d. Dismissed state for rejected items

**File:** `apps/web/src/lib/server/domains/feedback/pipeline/extraction.service.ts`

Currently, gate-rejected items are marked `completed`. Change this:

```
if (!gate.extract) {
  // For channel-monitored items, mark as 'dismissed' instead of 'completed'
  const isMonitored = context.metadata?.ingestionMode === 'channel_monitor'
  await db.update(rawFeedbackItems).set({
    processingState: isMonitored ? 'dismissed' : 'completed',
    stateChangedAt: new Date(),
    processedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(rawFeedbackItems.id, rawItemId))
  return
}
```

This means:

- **Shortcut items** that somehow fail the gate (shouldn't happen with auto-pass, but defensively) -> `completed`
- **Channel-monitored items** that fail the gate -> `dismissed`
- Existing queries for feedback suggestions/signals filter on `completed` and will naturally exclude `dismissed` items
- A future "audit dismissed items" view can query `processingState = 'dismissed'`

---

### Phase 4: Events API Endpoint

**New file:** `apps/web/src/routes/api/integrations/slack/events.ts`

**New file:** `apps/web/src/lib/server/integrations/slack/events.ts`

The route handler delegates to the events service, mirroring the interact pattern.

#### Request flow:

```
Slack Events API
    |
    v
POST /api/integrations/slack/events
    |
    v
1. Read raw body
2. Handle URL verification challenge (type: "url_verification")
   -> Return { challenge } immediately
3. Verify HMAC signature (reuse verifySlackSignature)
4. Parse event_callback payload
5. Deduplicate by event_id (in-memory LRU cache, ~10k entries, 5min TTL)
6. Dispatch by event.type:
   - "message" -> handleChannelMessage()
   - anything else -> 200 OK (ignore)
```

#### `handleChannelMessage(event, integrationId)`:

```
1. Filter out non-ingestible messages:
   - Skip if event.subtype exists (edits, deletes, joins, bot_message, etc.)
     Exception: no subtype = normal user message (the only kind we want)
   - Skip if event.bot_id is set (bot messages)
   - Skip if event.channel_type is not "channel" or "group"

2. Look up slack_channel_monitors row:
   SELECT * FROM slack_channel_monitors
   WHERE integration_id = ? AND channel_id = event.channel AND enabled = true

   If no row -> return (channel not monitored, ignore)

3. Resolve Slack user info:
   - Use event.user (Slack user ID)
   - Call client.users.info({ user: event.user }) for display name
   - Cache user lookups in-memory (LRU, 1000 entries, 10min TTL)
     (Avoids hammering Slack API for repeat posters)

4. Build permalink:
   - Format: https://slack.com/archives/{channelId}/p{ts_without_dot}

5. Call ingestRawFeedback() with:
   seed: {
     externalId: `${event.team}:${event.channel}:${event.ts}`,
     sourceCreatedAt: new Date(parseFloat(event.ts) * 1000),
     externalUrl: permalink,
     author: {
       name: userDisplayName,
       externalUserId: event.user,
     },
     content: {
       subject: '',                         // Left empty -- quality gate generates the title
       text: event.text,
     },
     contextEnvelope: {
       sourceChannel: { id: event.channel, name: channelName },
       metadata: {
         messageTs: event.ts,
         teamId: event.team,
         boardId: monitor.boardId,          // from the monitor config
         monitorId: monitor.id,
         ingestionMode: 'channel_monitor',  // triggers strict quality gate
       },
     },
   }
   context: {
     sourceId: slackFeedbackSource.id,
     sourceType: 'slack',
   }

6. Return 200 OK (must respond within 3 seconds per Slack docs)
```

#### Event deduplication strategy:

Slack retries events if it doesn't receive a 200 within 3 seconds. Two layers of dedup:

1. **In-memory LRU cache** keyed by `event_id` (fast, covers retries within the same process)
2. **Database dedupe** via existing `raw_feedback_items.(source_id, dedupe_key)` unique index (covers cross-process and across restarts)

#### Performance consideration:

The event handler must return 200 within 3 seconds. The monitored-channel lookup is a single indexed query. `ingestRawFeedback` does a dedupe check + insert + queue enqueue, all fast. User info lookup is cached. We should be well within budget, but the `ingestRawFeedback` call can be fire-and-forget like the interactivity handler does if needed.

---

### Phase 5: Bot Channel Membership

**File:** `apps/web/src/lib/server/integrations/slack/channels.ts`

Add a `joinChannel(accessToken, channelId)` function that calls `conversations.join`. The bot already has `channels:join` scope.

This is called:

- When an admin adds a new monitored channel (immediate join)
- On event receipt if the bot receives a `channel_not_found` error (defensive re-join)

Note: `conversations.join` only works for public channels. For private channels, the bot must be manually invited. The UI should surface this distinction.

---

### Phase 6: Shortcut Ingestion Mode Tag

**File:** `apps/web/src/lib/server/integrations/slack/interactivity.ts`

Update the existing "Send to Quackback" handler (`handleViewSubmission`) to tag its items with `ingestionMode: 'shortcut'` in the `contextEnvelope.metadata`. This enables the quality gate to differentiate and auto-pass shortcut items.

```ts
contextEnvelope: {
  sourceChannel: { id: channelId, name: channelName },
  metadata: {
    messageTs,
    teamId,
    boardId,
    ingestionMode: 'shortcut',  // NEW -- marks as human-curated
  },
},
```

---

### Phase 7: Server Functions (CRUD)

**File:** `apps/web/src/lib/server/functions/integrations.ts`

New server functions:

```ts
// List monitored channels for the current integration
export const listMonitoredChannelsFn = createServerFn(...)

// Add a channel to monitoring
export const addMonitoredChannelFn = createServerFn(...)
  // 1. Insert slack_channel_monitors row
  // 2. Bot joins the channel (conversations.join)
  // 3. Invalidate query cache

// Update a monitored channel (toggle enabled, change board)
export const updateMonitoredChannelFn = createServerFn(...)

// Remove a monitored channel
export const removeMonitoredChannelFn = createServerFn(...)
```

Also update `fetchIntegrationByType` in `apps/web/src/lib/server/functions/admin.ts` to include `monitoredChannels` in the Slack integration response (similar to how it returns `notificationChannels`).

---

### Phase 8: Settings UI

**File:** `apps/web/src/components/admin/settings/integrations/slack/slack-config.tsx`

Add a new "Channel monitoring" section below the existing "Notification routing" section. The two sections are visually separated but share the same channel picker infrastructure.

#### Layout:

```
Notifications enabled          [toggle]
-------------------------------------
Notification routing
  [existing routing table]
-------------------------------------
Channel monitoring                        <-- NEW
  "Automatically ingest all messages
   from these channels as feedback.
   Messages are filtered by AI to
   only capture genuine feedback."

  [monitored channels table]
    #feedback-raw     | Board: All     | [enabled toggle]
    #customer-support | Board: Support | [enabled toggle]
    [+ Add channel]

  [info callout if scopes are missing:
   "Reconnect Slack to enable channel monitoring.
    New permissions are required to read channel messages."
    [Reconnect]]
```

#### Monitored channels table:

Simpler than the notification routing table. Each row shows:

- Channel name with hash/lock icon
- Board assignment (dropdown or "All boards")
- Enabled toggle
- Expand -> remove button

#### Add monitored channel dialog:

Reuses `useSlackChannels()` hook for the channel picker. Fields:

- Channel selector (excludes already-monitored AND already-notification channels? Or allow overlap since they serve different purposes)
- Board selector (optional, defaults to none/all)
- Private channel warning: "The bot must be invited to private channels manually"

#### Reconnect prompt:

When `integrations.config.scopes` doesn't include `channels:history`, show an info banner:

> "Channel monitoring requires additional permissions. Please reconnect Slack to enable this feature."

With a "Reconnect" button that triggers the OAuth flow.

---

### Phase 9: Integration Definition Update

**File:** `apps/web/src/lib/server/integrations/slack/index.ts`

Update the catalog capabilities to mention channel monitoring:

```ts
capabilities: [
  { label: 'Send channel notifications', description: '...' },
  { label: 'Send to Quackback shortcut', description: '...' },
  {
    label: 'Channel monitoring',
    description: 'Automatically ingest messages from monitored channels as feedback',
  }, // NEW
]
```

---

## Pipeline Flow Comparison

### "Send to Quackback" (shortcut)

```
User triggers shortcut -> Modal -> handleViewSubmission
  |
  v
ingestRawFeedback(ingestionMode: 'shortcut')
  |
  v
enrich-context -> ready_for_extraction
  |
  v
extractSignals()
  -> shouldExtract(): auto-pass (high-intent source)
  -> full extraction + interpretation
  -> feedbackSuggestions created
```

### Channel monitoring

```
Slack Events API -> POST /api/integrations/slack/events
  |
  v
handleChannelMessage()
  -> filter (subtype, bot, monitored channel check)
  -> ingestRawFeedback(ingestionMode: 'channel_monitor')
  |
  v
enrich-context -> ready_for_extraction
  |
  v
extractSignals()
  -> shouldExtract(): strict LLM gate
  |
  +--> PASS: write suggestedTitle -> full extraction + interpretation
  |          -> feedbackSuggestions created
  |
  +--> FAIL: mark as 'dismissed' (no signals, no suggestions, invisible to admins)
```

---

## File Change Summary

### New files

| File                                                   | Purpose                  |
| ------------------------------------------------------ | ------------------------ |
| `apps/web/src/routes/api/integrations/slack/events.ts` | Events API route handler |
| `apps/web/src/lib/server/integrations/slack/events.ts` | Event processing logic   |

### Modified files

| File                                                                               | Change                                                   |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/db/src/schema/integrations.ts`                                           | Add `slackChannelMonitors` table + relations             |
| `packages/ids/src/...`                                                             | Register `slack_monitor` TypeID prefix                   |
| `apps/web/src/lib/server/domains/feedback/types.ts`                                | Add `'dismissed'` to `RawFeedbackProcessingState`        |
| `apps/web/src/lib/server/integrations/slack/oauth.ts`                              | Add `channels:history`, `groups:history` scopes          |
| `apps/web/src/lib/server/integrations/slack/channels.ts`                           | Add `joinChannel()` function                             |
| `apps/web/src/lib/server/integrations/slack/interactivity.ts`                      | Add `ingestionMode: 'shortcut'` to context metadata      |
| `apps/web/src/lib/server/integrations/slack/index.ts`                              | Update catalog capabilities                              |
| `apps/web/src/lib/server/integrations/slack/catalog.ts`                            | Add channel monitoring capability                        |
| `apps/web/src/lib/server/domains/feedback/pipeline/quality-gate.service.ts`        | Add shortcut auto-pass, strict channel-monitor gate      |
| `apps/web/src/lib/server/domains/feedback/pipeline/prompts/quality-gate.prompt.ts` | Add channel-monitor prompt variant                       |
| `apps/web/src/lib/server/domains/feedback/pipeline/extraction.service.ts`          | Handle `suggestedTitle` from gate, use `dismissed` state |
| `apps/web/src/lib/server/functions/integrations.ts`                                | CRUD server fns for monitored channels                   |
| `apps/web/src/lib/server/functions/admin.ts`                                       | Include monitored channels in integration query          |
| `apps/web/src/components/admin/settings/integrations/slack/slack-config.tsx`       | Channel monitoring UI section                            |
| `apps/web/src/routes/admin/settings/integrations/slack.tsx`                        | Pass monitored channels to component                     |
| `apps/web/src/lib/client/mutations.ts`                                             | Add mutation hooks for monitored channel CRUD            |
| `apps/web/src/lib/client/queries/admin.ts`                                         | Update integration query types                           |

### Migration

| File                             | Purpose                               |
| -------------------------------- | ------------------------------------- |
| `packages/db/drizzle/XXXX_*.sql` | Create `slack_channel_monitors` table |

---

## Slack App Configuration (admin docs)

Admins need to configure their Slack app with:

1. **Event Subscriptions** (in Slack App settings):
   - Request URL: `https://<your-domain>/api/integrations/slack/events`
   - Subscribe to bot events: `message.channels`, `message.groups`

2. **OAuth Scopes** (added automatically on reconnect):
   - `channels:history`, `groups:history`

3. **Reconnect** the Slack integration in Quackback settings to authorize the new scopes.

---

## Edge Cases and Considerations

### Message types to skip

- `subtype: "bot_message"` -- bot posts
- `subtype: "channel_join"` / `"channel_leave"` -- membership changes
- `subtype: "channel_topic"` / `"channel_purpose"` -- metadata changes
- `subtype: "message_changed"` / `"message_deleted"` -- edits/deletes
- `subtype: "thread_broadcast"` -- thread replies shared to channel
- Any message with `bot_id` set
- Messages from the Quackback bot itself (check against integration's bot user ID)

**Rule of thumb:** Only ingest messages where `subtype` is absent (normal user messages).

### Avoiding feedback loops

If Quackback's notification hook posts to a monitored channel, those bot messages would be received as events. The `bot_id` filter handles this, but we should also compare `event.user` against the integration's bot user ID (stored during OAuth as `authed_user` or derivable from `auth.test`).

### Cross-ingestion deduplication

If a user sends a message to a monitored channel AND someone also uses "Send to Quackback" on the same message, the `dedupeKey` format `slack:{teamId}:{channelId}:{messageTs}` is identical for both. The second ingestion is a no-op. The first one wins -- whichever path gets there first. Since the shortcut provides a human-written title and is higher trust, it would be ideal for it to win. In practice, the shortcut is triggered after the message exists, so the channel monitor event (real-time) will usually arrive first. This is acceptable -- the AI-generated title from the quality gate is good enough, and the human's manual submission being deduped is a minor trade-off vs. the complexity of "upgrade" logic.

### High-volume channels

No built-in rate limiting on ingestion. For very active channels (100+ messages/minute), the existing BullMQ pipeline handles backpressure. The event handler itself is lightweight (insert + enqueue). The quality gate filters most messages before the expensive extraction step. If this becomes an issue later, we can add per-channel rate limiting or batching.

### Channel renames

Slack sends `channel_rename` events. We could listen for these to update `channel_name` in the monitors table, but it's low priority since we also cache the name from the Slack API. For now, we update `channel_name` opportunistically when processing message events if it differs.

### Disconnect cleanup

When the Slack integration is disconnected, `ON DELETE CASCADE` on `slack_channel_monitors.integration_id` automatically removes all monitor configs. No additional cleanup needed.

---

## Build Sequence

1. **Schema + migration** (Phase 1) -- standalone, no dependencies
2. **OAuth scopes** (Phase 2) -- one-line change, independent
3. **Quality gate enhancements** (Phase 3) -- depends on Phase 1 for `dismissed` state
4. **Events endpoint + handler** (Phase 4) -- depends on Phase 1
5. **Bot join helper** (Phase 5) -- small utility, independent
6. **Shortcut ingestion mode tag** (Phase 6) -- tiny change, independent
7. **Server functions** (Phase 7) -- depends on Phase 1, 5
8. **Settings UI** (Phase 8) -- depends on Phase 7
9. **Integration catalog update** (Phase 9) -- trivial, any time

Phases 1, 2, 5, and 6 can be done in parallel. Phase 3 and 4 depend on 1. Phases 7-8 are sequential.
