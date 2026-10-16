# Ticket webhooks

Subscribe a webhook (Admin → Settings → Webhooks) to any of these topics. Topics
are opt-in: a webhook only receives the event types listed in its subscription.

## Topics

| Topic                            | Fired when                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ticket.created`                 | A ticket is opened, by a customer or a teammate.                                                         |
| `ticket.status_changed`          | A ticket moves between `open`/`pending`/`closed`.                                                        |
| `ticket.assigned`                | A ticket is assigned to or unassigned from a teammate or team.                                           |
| `ticket.replied`                 | A teammate or the requester replies on the ticket thread. `senderType` tells the two apart.              |
| `ticket.note_added`              | A teammate adds an **internal note**. Private content, so subscribe only if your endpoint should get it. |
| `ticket.external_status_changed` | A tracker issue linked to the ticket changes status on the external platform.                            |
| `ticket.due_changed`             | A teammate, workflow, integration or bulk action sets, moves or clears the ticket's due date.            |
| `ticket.due_soon`                | An open ticket's due date is less than 24 hours away. Fires once per due date.                           |
| `ticket.overdue`                 | An open ticket's due date has passed. Fires once per due date.                                           |

A due date the customer proposes when they file the ticket arrives on
`ticket.created` (in `ticket.dueAt`), not as a separate `ticket.due_changed`.
`ticket.due_changed` fires only when the value actually changes, so re-setting
the same date sends nothing.

`ticket.due_soon` and `ticket.overdue` come from a per-minute sweep, so they
arrive within about a minute of the moment they describe. A ticket that is
resolved or deleted before then gets no alert. A date that is already past when
it is set sends neither alert, since it is a record rather than news. A date
less than 24 hours away that the assignee sets on their own ticket skips
`ticket.due_soon`, but `ticket.overdue` still fires if the date passes.

## The ticket ref

Every ticket event carries the ticket as `ticket` (on `ticket.created` the ref's
fields sit inside a fuller ticket object with the title, status, stage,
requester and timestamps):

```json
{
  "id": "ticket_01j…",
  "number": 142,
  "type": "customer",
  "ticketTypeId": "ticket_type_01j…",
  "priority": "high",
  "assignedPrincipalId": "principal_01j…",
  "assignedTeamId": null,
  "dueAt": "2026-10-21T21:59:00.000Z"
}
```

- `dueAt` is the ticket's one shared due date as an ISO 8601 instant, or `null`
  when it has none. It is the same date the customer sees on their ticket.
  Events recorded before due dates shipped have no `dueAt` key at all, so treat
  a missing key like `null`.
- The due date is independent of SLA targets. SLA deadlines live on the SLA
  events (`sla.approaching_breach`, `sla.breached`), which carry this same
  ticket ref for the ticket's time-to-resolve clock.

## Due-date payloads

`ticket.due_changed`: the new and previous dates, each `null` when unset.

```json
{
  "id": "evt_01j…",
  "type": "ticket.due_changed",
  "createdAt": "2026-10-14T09:12:44.103Z",
  "data": {
    "ticket": { "id": "ticket_01j…", "number": 142, "dueAt": "2026-10-21T21:59:00.000Z", "…": "" },
    "title": "Export fails on large CSV",
    "dueAt": "2026-10-21T21:59:00.000Z",
    "previousDueAt": null
  }
}
```

A cleared date has `"dueAt": null` and the date it replaced in `previousDueAt`.

`ticket.due_soon` and `ticket.overdue`: the due date the alert is about.

```json
{
  "id": "evt_01j…",
  "type": "ticket.overdue",
  "createdAt": "2026-10-21T22:00:03.512Z",
  "data": {
    "ticket": { "id": "ticket_01j…", "number": 142, "dueAt": "2026-10-21T21:59:00.000Z", "…": "" },
    "title": "Export fails on large CSV",
    "dueAt": "2026-10-21T21:59:00.000Z"
  }
}
```

The actor of both alerts is the scheduled sweep, not a person.

### One alert per due date

Each alert has a stable key built from the ticket and the due date,
`timer:ticket.<due_soon|overdue>:<ticketId>:<dueAt>`, and Quackback writes at
most one event per key. A repeat sweep for the same date sends nothing. Moving
the due date makes a new key, so both alerts are armed again for the new date.

The webhook `id` identifies one event and stays the same across delivery
retries. To dedupe alerts per due date on your side as well, key on `type`,
`data.ticket.id` and `data.dueAt` together.

## Workflow triggers

`ticket.created`, `ticket.status_changed`, `ticket.due_changed`,
`ticket.due_soon` and `ticket.overdue` can also start workflows. Workflows run
in a conversation, so these triggers only reach tickets linked to a customer
conversation. A back-office ticket with no customer conversation still sends
its webhooks, its in-app notifications and its emails, but starts no workflow.

## Notifications

`ticket.due_soon` and `ticket.overdue` also notify the ticket's assignee, or
every member of its assigned team when no one is assigned, in the app and by
email. Each teammate can turn either off under notification preferences. An
unassigned ticket with no team notifies no one, though its webhooks still fire.

## Payload envelope

```json
{
  "id": "evt_…",
  "type": "ticket.assigned",
  "createdAt": "2026-06-05T00:00:00.000Z",
  "data": { "ticket": { "…": "" }, "assignedPrincipalId": "principal_…" }
}
```

## Verifying delivery

Each request carries `X-Quackback-Signature: sha256=<hex>` and `X-Quackback-Timestamp: <unix>`.

1. Recompute `HMAC-SHA256(secret, "<X-Quackback-Timestamp>.<raw body>")` and compare
   it to the signature using a constant-time comparison.
2. Reject requests whose timestamp is more than ~5 minutes old (replay protection).
   Never use a tolerance of `0`.
3. Deduplicate on the event `id`. Delivery is **at-least-once**, so duplicates are possible.
4. Do not assume ordering. Order by the payload `createdAt`, and fetch current
   state via the read API when correctness depends on it (payloads are point-in-time
   snapshots: a `ticket.due_soon` may arrive after the date has moved again).
5. Respond `2xx` quickly, then process asynchronously.
