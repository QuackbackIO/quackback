# Webhooks API Brainstorm

**Date:** 2026-01-30
**Status:** Ready for Planning
**Priority:** High - unlocks support integration, PM sync, Slack automation, triage workflows

---

## What We're Building

A webhook system that notifies external services when events occur in Quackback. Customers can register HTTP endpoints to receive real-time notifications for feedback activity.

### Supported Events

| Event                 | Trigger                                  | Use Cases                            |
| --------------------- | ---------------------------------------- | ------------------------------------ |
| `post.created`        | New feedback submitted                   | Triage, Slack alerts, support sync   |
| `post.status_changed` | Status updated (e.g., Open → Shipped)    | PM tool sync, customer notifications |
| `post.vote_threshold` | Post reaches 5, 10, 25, 50, or 100 votes | Popular request alerts               |
| `comment.created`     | New comment on a post                    | Conversation monitoring              |

### Filtering

Webhooks can be scoped to:

- **Specific boards** - Only fire for posts in selected boards
- **Specific tags** - Only fire for posts with selected tags
- **Combined** - Both board AND tag filters

### Delivery & Reliability

- **Retries:** Exponential backoff (1min, 5min, 30min) - 3 attempts max
- **Security:** HMAC-SHA256 signature in `X-Quackback-Signature` header
- **Timeout:** 10 second response timeout per delivery attempt

---

## Why This Approach

**Lightweight In-Process** was chosen over event bus or third-party services because:

1. **Simplicity** - No new infrastructure (Redis, external services)
2. **Debuggability** - All state in Postgres, easy to query and fix
3. **Sufficient for scale** - Handles thousands of webhooks/day without issues
4. **Matches stack** - Consistent with existing Drizzle + Postgres patterns

The slight latency impact (~50-100ms added to API responses) is acceptable for the use cases. If volume grows significantly, can migrate to event bus later.

---

## Key Decisions

| Decision        | Choice                                                                   | Rationale                                               |
| --------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| Event types     | 4 events (post.created, status_changed, vote_threshold, comment.created) | Covers primary integration needs                        |
| Vote thresholds | Fixed milestones (5, 10, 25, 50, 100)                                    | Simple UX, avoids per-webhook config complexity         |
| Filtering       | Board + Tag filters                                                      | Granular enough for real use cases                      |
| Retries         | 3 retries with exponential backoff                                       | Industry standard, balances reliability with simplicity |
| Security        | HMAC-SHA256 signatures                                                   | Required for production integrations                    |
| API design      | Full RESTful CRUD                                                        | Consistent with existing API patterns                   |
| Architecture    | In-process with DB retry queue                                           | No new dependencies, easy to debug                      |

---

## API Design

### Webhook Management Endpoints

```
POST   /api/v1/webhooks          - Create webhook
GET    /api/v1/webhooks          - List webhooks
GET    /api/v1/webhooks/:id      - Get webhook details
PATCH  /api/v1/webhooks/:id      - Update webhook
DELETE /api/v1/webhooks/:id      - Delete webhook
```

### Create Webhook Request

```json
POST /api/v1/webhooks
{
  "url": "https://example.com/webhook",
  "events": ["post.created", "post.status_changed"],
  "filters": {
    "boardIds": ["board_01h455vb4pex5vsknk084sn02q"],
    "tagIds": ["tag_01h455vb4pex5vsknk084sn02q"]
  },
  "voteThresholds": [10, 50]  // Only for post.vote_threshold event
}
```

### Webhook Response

```json
{
  "data": {
    "id": "whk_01h455vb4pex5vsknk084sn02q",
    "url": "https://example.com/webhook",
    "events": ["post.created", "post.status_changed"],
    "filters": { "boardIds": [...], "tagIds": [...] },
    "voteThresholds": [10, 50],
    "secret": "whsec_abc123...",  // Only shown on create
    "status": "active",
    "createdAt": "2026-01-30T12:00:00Z"
  }
}
```

### Webhook Payload Format

```json
{
  "id": "evt_01h455vb4pex5vsknk084sn02q",
  "type": "post.created",
  "createdAt": "2026-01-30T12:00:00Z",
  "data": {
    "post": {
      "id": "post_01h455vb4pex5vsknk084sn02q",
      "title": "Add dark mode",
      "content": "Please add dark mode to the app",
      "boardId": "board_01h455vb4pex5vsknk084sn02q",
      "boardSlug": "feature-requests",
      "statusId": "status_01h455vb4pex5vsknk084sn02q",
      "statusSlug": "open",
      "authorEmail": "user@example.com",
      "voteCount": 1,
      "createdAt": "2026-01-30T12:00:00Z"
    }
  }
}
```

### Signature Verification

Header: `X-Quackback-Signature: sha256=<hex_digest>`

Verification (Node.js example):

```javascript
const crypto = require('crypto')

function verifySignature(payload, signature, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}
```

---

## Database Schema

### webhooks table

```sql
CREATE TABLE webhooks (
  id            TEXT PRIMARY KEY,  -- whk_xxx TypeID
  url           TEXT NOT NULL,
  secret        TEXT NOT NULL,     -- For HMAC signing
  events        TEXT[] NOT NULL,   -- Array of event types
  board_ids     TEXT[],            -- Filter: specific boards
  tag_ids       TEXT[],            -- Filter: specific tags
  vote_thresholds INTEGER[],       -- For vote_threshold event
  status        TEXT DEFAULT 'active',  -- active, paused, disabled
  failure_count INTEGER DEFAULT 0,
  last_triggered_at TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);
```

### webhook_deliveries table (for retry queue)

```sql
CREATE TABLE webhook_deliveries (
  id            TEXT PRIMARY KEY,  -- whd_xxx TypeID
  webhook_id    TEXT REFERENCES webhooks(id),
  event_id      TEXT NOT NULL,     -- evt_xxx TypeID
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  status        TEXT DEFAULT 'pending',  -- pending, delivered, failed
  attempts      INTEGER DEFAULT 0,
  next_retry_at TIMESTAMP,
  last_error    TEXT,
  created_at    TIMESTAMP DEFAULT NOW(),
  delivered_at  TIMESTAMP
);

CREATE INDEX idx_webhook_deliveries_pending
  ON webhook_deliveries(next_retry_at)
  WHERE status = 'pending';
```

---

## Open Questions

1. **Delivery logs UI** - Should we expose delivery history via API? (Useful for debugging)
2. **Webhook testing** - Should we add a "test webhook" endpoint that sends a sample payload?
3. **Rate limiting** - Should we limit webhooks per workspace? (e.g., max 10 webhooks)
4. **Pause on failure** - Auto-disable webhook after N consecutive failures?

---

## Out of Scope (for v1)

- Webhook templates (pre-built integrations for Linear, Jira, etc.)
- Webhook transformation (modify payload format)
- Batching (combine multiple events into one delivery)
- Replay functionality (re-send past events)

---

## Next Steps

Run `/workflows:plan` to create implementation plan with:

1. Database migration for webhooks tables
2. Webhook management API endpoints
3. Event emission from service layer
4. Delivery + retry worker
5. Tests and documentation
