# Conversation lifecycle rollout

This change keeps the existing Messenger, Email, Quinn Basics, and Workflows settings pages. Each channel selects Built-in rules, Custom workflows, or Off. Team and Quinn policies retain independent follow-up and closure controls. Custom workflow audience exclusions intentionally receive no built-in fallback.

## Defaults and compatibility

| Policy         | One follow-up                   | Closure          |
| -------------- | ------------------------------- | ---------------- |
| Team Messenger | 15 minutes, visitor online only | 30 minutes       |
| Team email     | Off                             | 72 hours, silent |
| Quinn chat     | Resolution check at 5 minutes   | 15 minutes       |
| Quinn email    | Resolution check at 24 hours    | 72 hours         |

Both actions use the same persisted activity anchor. Follow-ups do not reset it. Public human replies start team periods; substantive Quinn answers and clarification waits have separate ownership. Handoffs wait for a human reply. Customer replies cancel the period. Snooze pauses processing and waking starts a new period. Native-close channels and active interactive workflow waits are excluded.

Metadata uses version 2, section-scoped updates, and a shared revision. Stale editors receive a conflict with their draft retained. Messenger writes require `settings.manage`, email requires `channel_account.manage`, and Quinn requires `assistant.manage`. The legacy master switches, durations, custom text, and shared Quinn email choices remain readable. Contact capture defaults to Off; agent correction only changes anonymous contact details.

## Deployment order

1. Apply additive migration `0284_conversation_inactivity.sql` before starting this application version. It initializes channel ownership once from existing live customer-inactivity workflows and backfills activity from actual message authors and involvements. An absent channel filter owns both supported channels; audience filters are preserved.
2. Start the application and existing job workers. The minute snooze sweep uses the shared inactivity deadlines. Actions process at most 200 due rows per batch, ordered by deadline and ID; `conversation-inactivity-continuation` drains the backlog in further bounded batches.
3. Confirm existing custom-workflow channels still show Custom workflows. Review the enabled defaults for other existing conversations. Publishing a new workflow does not change ownership; the publish UI offers an explicit channel-mode action.
4. Check structured `conversation-inactivity` batch logs (`followedUp`, `closed`, `resolved`, `abandoned`, `stale`) and `conversation-inactivity-delivery` failures. Inspect pending/failed email delivery in the existing transcript diagnostics and durable queue. Each committed action owns a stable key and transcript message; retries reuse that message and email Message-ID.

Closure and assumed/abandoned outcomes commit together with their outbox events and delivery job. Team email closure remains silent. Quinn email closure uses the channel lifecycle adapter; follow-ups use the threaded email-reply sender. Neither inactivity closure path introduces automatic CSAT; workflow actions remain responsible for CSAT. Previously committed closure delivery may complete after a mode change.

## Rollback

Set Inactivity handling to Off and save on both Messenger and Email. This disables built-in actions and customer-inactivity workflow triggers, and interrupts pending runs from those triggers. Pending email follow-ups recheck the mode before delivery. Existing published workflow definitions remain intact, as do unrelated runs and abandoned-journey handling. Retain the additive schema and recorded lifecycle state. Do not reopen already-closed conversations as part of rollback. Changing back to Built-in rules or Custom workflows reuses saved policies.

## Verification

The implementation has focused coverage for legacy resolution, independent clocks, section authorization, stale edits, preserved drafts, contact modes and identity races, human takeover, snooze/wake, interactive waits, custom ownership, concurrent replies/workers, rollback on enqueue failure, email retries, and 410 mixed-channel candidates. Migration tests exercise the actual ownership/backfill SQL. Composer coverage includes send failure, close failure, required attributes, linked-ticket confirmation, notes, and the keyboard shortcut. A local SMTP test receives the rendered follow-up and validates its threading header.

Run from the worktree with disposable migrated databases:

```sh
bun run typecheck
bun run lint
TEST_DATABASE_URL=<empty-regression-database> bun vitest run --no-file-parallelism apps/web/src/lib/server/domains/conversation apps/web/src/lib/server/domains/assistant apps/web/src/lib/server/domains/workflows apps/web/src/lib/server/domains/channels apps/web/src/lib/server/domains/settings apps/web/src/lib/server/policy
TEST_DATABASE_URL=<isolated-lifecycle-database> bun vitest run apps/web/src/lib/server/domains/conversation/__tests__/conversation-inactivity.db.test.ts
DRIFT_CHECK_DATABASE_URL=<disposable-postgres-server> bun run db:check-drift
git diff --check
```

The dedicated lifecycle test requires an explicitly named `lifecycle` database with a settings row; it temporarily changes workspace settings and must run separately from browser checks. Other database suites expect an empty migrated database. Serial execution avoids existing fixture interference between files.

Browser evidence from the local seeded app is captured at `/tmp/lifecycle-{messenger,email,quinn}-{desktop,mobile}.png`, `/tmp/lifecycle-visitor-contact-mobile.png`, `/tmp/lifecycle-visitor-filled-mobile.png`, `/tmp/lifecycle-visitor-sent-mobile.png`, and `/tmp/lifecycle-agent-contact-desktop.png`. Settings Save/Cancel and reload, required capture validation/submission, and contact correction are checked in an actual browser. No production rollout or external customer email is part of this verification.
