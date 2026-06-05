# Conversation & message webhooks

Subscribe a webhook (Admin → Settings → Webhooks) to any of these topics. Topics
are opt-in: a webhook only receives the event types listed in its subscription.

## Topics

| Topic                           | Fired when                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `conversation.created`          | A visitor starts a new conversation.                                                                     |
| `conversation.status_changed`   | A conversation moves between `open`/`pending`/`closed`.                                                  |
| `conversation.assigned`         | A conversation is assigned to or unassigned from an agent (includes auto-routing).                       |
| `conversation.priority_changed` | A conversation's priority changes.                                                                       |
| `conversation.csat_submitted`   | A visitor records or updates their satisfaction rating or comment.                                       |
| `message.created`               | A visitor or agent sends a public message.                                                               |
| `message.note_created`          | An agent adds an **internal note**. Private content — subscribe only if your endpoint should receive it. |
| `message.deleted`               | A public message is soft-deleted.                                                                        |

Internal-note deletions are not emitted. System messages (e.g. "chat ended") are
represented by `conversation.*` events, not `message.created`. Anonymous visitors'
emails are never included (synthetic addresses are stripped to `null`). Because a
visitor can submit a rating and a comment separately, `conversation.csat_submitted`
may fire more than once for one conversation; each payload carries the current CSAT
snapshot, so treat it as an upsert keyed on the conversation rather than counting events.

## Payload envelope

```json
{
  "id": "evt_…",
  "type": "message.created",
  "createdAt": "2026-06-05T00:00:00.000Z",
  "data": { "message": { "…": "" }, "conversation": { "…": "" } }
}
```

## Verifying delivery

Each request carries `X-Quackback-Signature: sha256=<hex>` and `X-Quackback-Timestamp: <unix>`.

1. Recompute `HMAC-SHA256(secret, "<X-Quackback-Timestamp>.<raw body>")` and compare
   it to the signature using a constant-time comparison.
2. Reject requests whose timestamp is more than ~5 minutes old (replay protection).
   Never use a tolerance of `0`.
3. Deduplicate on the event `id` — delivery is **at-least-once**, so duplicates are possible.
4. Do not assume ordering. Order by the payload `createdAt`/`timestamp`; fetch current
   state via the read API when correctness depends on it (payloads are point-in-time snapshots).
5. Respond `2xx` quickly, then process asynchronously.
