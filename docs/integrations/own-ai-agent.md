# Your own AI agent

The experimental `ownAgent` feature lets one external AI answer Messenger
conversations using its own service identity. Enable **Your AI agent** in
Settings > Labs, register it in **Agents & API > Your AI**, then choose it in
**Support > Who answers**. Registration and credential changes require an admin
with API credential permission and a recent sign-in. Changing who answers also
requires a recent admin sign-in. The feature is off by default.

Self-hosted installations can opt in without a plan check. Hosted installations
also require the control plane to project `entitlements.ownAgent: true`. The
local plan catalogue lists Pro and higher for display purposes; a paid plan name
alone does not grant access. An older projection without the new entitlement
keeps hosted access disabled.

## Local development

Leave the endpoint URL empty to run an agent on your laptop. No inbound endpoint
or public tunnel is needed. Keep the one-time `qba_` credential in your agent's
environment. It reaches only the agent API and does not grant teammate REST,
settings, or MCP permissions.

Poll for work with the credential:

```sh
curl --fail-with-body "$QUACKBACK_URL/api/v1/agent/turns" \
  -H "Authorization: Bearer $QUACKBACK_AGENT_TOKEN"
```

The response is `{ "data": { "turns": [...] } }`. Each entry contains `turnId`,
`deadlineAt`, and `context`. The context contains the conversation, customer,
and up to 40 recent public messages. Internal notes are excluded. Its
`untrusted.fields` list marks outside text that an agent must treat as data,
including customer names and messages.

Use a modest polling interval and handle `429` with backoff. Multiple polls can
return the same requested turn. Deduplicate by turn ID, stop working when its
deadline passes, and preserve the reply payload and idempotency key across
network retries.

Post a final answer using the conversation and turn IDs from the feed:

```sh
curl --fail-with-body "$QUACKBACK_URL/api/v1/agent/conversations/$CONVERSATION_ID/reply" \
  -H "Authorization: Bearer $QUACKBACK_AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @reply.json
```

```json
{
  "turnId": "support_agent_turn_REPLACE_WITH_ACTUAL_ID",
  "content": "Your answer in Markdown",
  "citations": [{ "title": "Source", "url": "https://example.com/help" }],
  "idempotencyKey": "a-stable-key-for-this-answer"
}
```

Successful replies return the message ID and `replayed`. Repeating the same key
and payload returns that message without posting again. Reusing the key with a
different payload returns `409`. The message, receipt, outcome accounting, and
message-created outbox event commit together.

## Agent API

All paths below start with `/api/v1/agent`. Every request uses
`Authorization: Bearer qba_...`.

| Method and path                     | Request or result                                                       |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `GET /turns`                        | Current requested turns, up to 25, with public context                  |
| `GET /conversations/{id}`           | Public context for a conversation the agent controls                    |
| `POST /conversations/{id}/activity` | `{ "status": "thinking" }`, `searching_kb`, or `reviewing_conversation` |
| `POST /conversations/{id}/stream`   | `application/x-ndjson` body: one `{ "text": "..." }` chunk per line     |
| `POST /conversations/{id}/reply`    | Turn ID, Markdown content, optional citations, and idempotency key      |
| `POST /conversations/{id}/handoff`  | `{ "turnId": "...", "reason": "capability_limit", "note": "..." }`      |
| `POST /conversations/{id}/resolve`  | `{ "turnId": "...", "confirmed": true, "summary": "..." }`              |

Streaming publishes temporary text through the existing widget AI stream.
Post `/reply` separately to persist the final answer. Lines are limited to
16 KiB and an idle stream ends after five seconds. Activity and streaming do
not extend the turn deadline. Handoff and resolution apply only to the current
turn. Resolution records an AI outcome; it does not close the conversation.

A newer customer message supersedes the previous turn. A teammate's public
reply takes control in the same database transaction as that reply. Late
answers, handoffs, and resolutions return `409`. Closed or snoozed conversations
reject agent writes. Rotated credentials stop authenticating immediately;
paused or removed agents cannot keep streaming with a previously authenticated
request.

## Webhook delivery

Set a public HTTPS endpoint to receive `agent.turn_requested` through the
existing durable event and delivery queues. A local/private address is refused
by the SSRF guard. The body contains the event ID, creation time, turn ID,
deadline, agent identity, public context, and conversation callback URLs.

Verify `X-Quackback-Signature` using the one-time signing secret:

```text
sha256=hex(HMAC-SHA256(signingSecret, timestamp + "." + rawRequestBody))
```

`timestamp` is the exact `X-Quackback-Timestamp` header value. Compare signatures
in constant time and reject timestamps outside your accepted replay window.
Deduplicate `X-Quackback-Delivery` and the turn ID. Acknowledge promptly with a
2xx response and run the agent separately; delivery waits at most five seconds.
The worker retries transient network failures, `429`, and `5xx`. Permanent
delivery failures trigger the configured fallback. Each attempt rechecks the
agent's access, controller lease, and live turn before sending customer data.

## Deadlines and fallback

The default deadline is 20 seconds, configurable from 5 to 120 seconds. The
deadline job falls back to the team or the built-in AI. Built-in fallback uses
its normal entitlement, token budget, and conversation eligibility checks; it
hands off when it cannot answer. Fallback is recoverable and idempotent, and an
old deadline cannot steal a newer turn or a teammate's conversation.

External replies use the AI badge and existing involvement analytics. They do
not run a Quackback model or consume its answer allowance. Any separate
knowledge-search calls remain subject to their own normal gates and budget.

## Current scope

This slice supports one external agent per workspace, a global Messenger
answerer, local polling, and signed push delivery. It does not yet provide a
resumable event stream, per-channel exceptions, workflow transfer steps, a
connection-test endpoint, activity-based deadline extensions, circuit breaking,
or programmatic agent registration. Email answering is also outside this
slice. The general REST settings registry and MCP continue to use their
existing credential and approval boundaries.

Local validation covers real PostgreSQL concurrency and compiled-app HTTP/UI
flows. Delivery tests exercise the signed request, lease checks, retry/fallback
decisions, and SSRF refusal with a controlled network adapter. They do not
certify an external model or a deployed third-party webhook endpoint.
