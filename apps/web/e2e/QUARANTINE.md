# E2E quarantine

A quarantined test is one we know fails for a reason this suite cannot fix by
itself (missing infrastructure in CI, or a product question that needs an
answer). It stays in the code, so nobody loses it, but the nightly `e2e-full`
job leaves it out, so it cannot hide new failures.

## How it works

- Mark the test with the `@quarantine` tag and a `quarantine` annotation that
  gives the cause:

  ```ts
  test(
    'title',
    {
      tag: '@quarantine',
      annotation: { type: 'quarantine', description: 'Why it fails' },
    },
    async ({ page }) => {
      // ...
    }
  )
  ```

- `e2e-full` runs with `--grep-invert @quarantine`.
- `e2e-quarantine` runs nightly with `--grep @quarantine`. It never fails the
  workflow. Its job summary lists every quarantined test, its result and its
  cause, so a test that starts to pass is easy to see. It runs each test
  apart from the rest of its file, so one pass there does not prove a fix:
  run the whole file before you lift a quarantine.
- Every quarantined test has an entry below with an owner and a review date. On
  the review date, fix the test, fix the product, or delete the test with a
  reason. Do not extend the date without a reason in the entry.

## The rule: an owner and two weeks

- A test enters quarantine with a named owner (a person, not a team) and a
  review date no more than two weeks out. "owner: unassigned" is only allowed
  for the entries below that predate this rule, and each of them needs an owner
  before its review date.
- The owner either fixes it (test or product) and removes the tag, or deletes
  it with the reason in the commit, by the review date.
- One extension of up to two weeks is allowed, with the reason written in the
  entry. A second extension needs the code owner's sign-off in the PR.
- The nightly `e2e-quarantine` summary lists every quarantined test, so a test
  that has started to pass, or one past its date, is visible every morning.
- The support suite (`playwright.support.config.ts`) follows the same rule and
  tag; its nightly run leaves `@quarantine` out in the same way.

## Quarantined tests

Every entry has owner: unassigned and review by: 2026-12-02.

### Suspected product bugs

- `admin/settings-team.spec.ts` › add people dialog cancel closes the dialog.
  With the People field focused (it focuses itself when the dialog opens), the
  first click on Cancel does not close the Add people dialog; a second click
  does. The dialog code (`add-people-dialog.tsx`) looks right, so the
  combobox's blur or outside-click handling may take the first click. It
  failed in its file locally but passed on its own in the first CI quarantine
  run, so the cause is not confirmed. owner: unassigned, review by:
  2026-12-02.

### Needs a product decision

- `public/notifications.spec.ts` › Portal Notifications (unauthenticated) ›
  redirects away from /notifications when not logged in. A signed-out visitor
  sees the Notifications page heading. The route has never had an auth guard,
  so decide whether it should redirect, show a sign-in gate, or stay as it is.
  owner: unassigned, review by: 2026-12-02.

### Support API and MCP (support suite)

- `support/mcp.spec.ts` › MCP tickets › API-63 reply_to_ticket and
  add_ticket_note take up to 10000 characters as advertised. The tools'
  schemas accept content up to 10000 characters (`mcp/tools/tickets.ts:328`,
  `:371`), but the shared message write refuses anything over 4000
  (`messages/message-core.ts:93`, `MAX_CONVERSATION_MESSAGE_LENGTH`), so a
  9000-character reply or note fails with "Message must be 4,000 characters
  or less". Either the schemas or the limit is wrong. owner: unassigned,
  review by: 2026-12-03.

### Support suite: webhooks (PR 5c)

- `support/webhooks.spec.ts` › webhook subscriptions › API-69 a deleted
  webhook frees its place under the 25-webhook cap. Product bug:
  `createWebhook` counts every row, soft-deleted ones included, toward
  `MAX_WEBHOOKS` (`apps/web/src/lib/server/domains/webhooks/webhook.service.ts:69`),
  so after 25 create/delete cycles a workspace can never create another
  webhook. The suite works around it by removing soft-deleted sink webhooks
  before each subscription (`e2e/support/webhooks.ts`
  `purgeDeletedSinkWebhooks`). owner: unassigned, review by: 2026-12-03.
- `support/webhooks.spec.ts` › conversation events › API-92 sla.breached is
  delivered with no live SLA workflow. Known bug SLA-23: SLA timer events are
  dispatched only from `sweepSlaTimerTriggers`, which returns early unless a
  live workflow has that trigger
  (`apps/web/src/lib/server/domains/workflows/workflow-sweep.ts`). It can pass
  by accident while another test has a live SLA workflow. owner: unassigned,
  review by: 2026-12-03.
