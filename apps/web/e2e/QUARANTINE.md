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

### Support API and MCP (support suite)

- `support/mcp.spec.ts` › MCP tickets › API-63 reply_to_ticket and
  add_ticket_note take up to 10000 characters as advertised. The tools'
  schemas accept content up to 10000 characters (`mcp/tools/tickets.ts:328`,
  `:371`), but the shared message write refuses anything over 4000
  (`messages/message-core.ts:93`, `MAX_CONVERSATION_MESSAGE_LENGTH`), so a
  9000-character reply or note fails with "Message must be 4,000 characters
  or less". Either the schemas or the limit is wrong. owner: unassigned,
  review by: 2026-12-03.
### Support suite: known product bugs (fixes in flight)

These assert the right behaviour and fail until the fix lands. Review by
2026-12-03.

- `support/access.spec.ts` › opening by id › ACC-05 a teammate without
  conversation.view opening an Unassigned conversation by URL is refused, not
  shown an empty thread. Known bug: `getConversationFn` refuses the call, but
  the inbox still renders the thread pane for the URL (empty, "No messages
  yet", with a reply box) instead of a not-found or no-access state. owner:
  unassigned, review by: 2026-12-03.

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

### Support suite: routing switch permission (known bug)

- `support/routing.spec.ts` › the routing switch › RTE-03 a Support lead
  (routing.manage) may read and change the routing switch. The routing
  switch's server functions require `settings.manage`
  (`functions/settings.ts:930`, `:940`), so the Support lead role, whose
  description lists routing and which holds `routing.manage`, is refused. The
  test asserts the intended rule. owner: unassigned, review by: 2026-12-03.

### Support email journeys (`tests/support/email-*.spec.ts`)

Known bugs (fixes in flight) and bugs found while writing these journeys. Each
test asserts the right behaviour; the working part of each journey is proved
by a separate test that is not quarantined.

- `support/email-inbound.spec.ts` › CUS-E-07 a new cold email conversation
  appears live in an open inbox. Known bug: an unrouted new email
  conversation publishes no realtime frame, so an open inbox shows it only
  after a refetch. owner: unassigned, review by: 2026-12-03.
- `support/email-inbound.spec.ts` › CUS-E-15 a reply to a spam-filed thread
  is kept but stays closed in Spam. Waits for #1084, which keeps a customer
  message on a spam conversation in Spam (owner decision 2026-11-19); today the
  reply reopens the thread and keeps the spam marker, so it shows in neither
  triage nor Spam. Lift when #1084 lands. owner: unassigned, review by:
  2026-12-03.
- `support/email-outbound.spec.ts` › CUS-O-08 References repeats our earlier
  Message-IDs exactly as they were sent. Found here: outbound ids are stored
  lower-cased (`conversation.email-store.ts` `normalizeMessageId`, used by
  `recordOutboundEmail`) and the References chain is rebuilt from that store,
  so it carries a spelling we never sent; a client that matches ids exactly
  can lose the thread. owner: unassigned, review by: 2026-12-03.
- `support/email-outbound.spec.ts` › CUS-O-16 a teammate-filed ticket sends
  the requester the confirmation and no conversation email. Found here: a
  customer ticket filed by a teammate (API key) writes its opening message
  into the backing conversation as a teammate message after commit
  (`ticket-intake.service.ts`), which runs `notifyAgentReply`
  (`conversation.service.ts`), so the requester also gets "<agent> replied to
  your conversation" with the description. Same family as CUS-O-17. owner:
  unassigned, review by: 2026-12-03.
- `support/email-outbound.spec.ts` › CUS-O-17 one agent reply on a ticket
  sends the requester exactly one email. Known bug: a reply on a ticket with
  a linked conversation sends both the ticket reply email and a conversation
  reply email. owner: unassigned, review by: 2026-12-03.
- `support/email-outbound-csat.spec.ts` › CUS-O-23 an emailed face link opens
  with its face preselected and records nothing; › CUS-O-27 an out-of-range
  numeric rating still opens the page with nothing preselected. Found here:
  every face link in the close and rating-request emails
  (`/csat?token=…&rating=4`) renders the error page. The router parses
  `rating=4` into the number 4 and the route's search schema
  (`routes/csat.tsx` `searchSchema`, `rating: z.string().optional()`)
  refuses it; `rating=abc` and a link with no rating work. The other CSAT
  journeys open the page with the token alone. owner: unassigned, review by:
  2026-12-03.

Found here, with no quarantined test: the background job worker keeps the
workspace settings it first read for as long as the app runs. The job loop
runs inside one log context (`jobs/worker.ts` `runWithLogContext`), and
`memoizePerRequest` (`request-memo.ts`) keys on that context, so
`getWorkspaceSettings` (`settings.service.ts`) never re-reads in the worker.
A setting switched on after boot (Support tickets) reaches a job only when that
job happens to run inline in the request; picked up by the worker, the job
still sees the boot value and, for ticket mail, sends nothing. The support
suite turns Support tickets on before the app starts (`support/start-app.ts`).
No deterministic test: whether an event job runs inline or in the worker is
not under the suite's control, and the one job-read setting the suite could
switch on after boot is part of its baseline. owner: unassigned, review by:
2026-12-03.

### Support suite: SLA, ratings and notification emails

Each entry: owner: unassigned, review by: 2026-12-03.

- `support/sla-clocks.spec.ts` › default SLA at intake: known gaps › SLA-07
  the ticket.created webhook carries the ticket SLA. The ticket is stamped at
  intake, but the `ticket.created` payload is built by `ticketData()`
  (`ticket.webhooks.ts`), which has no SLA field, so subscribers never see the
  due date. Known bug. owner: unassigned, review by: 2026-12-03.
- `support/sla.spec.ts` › SLA in the inbox › SLA-26 picking "SLA breach
  soonest" in All conversations orders the list by due time. The sort menu
  (`conversation-list-toolbar.tsx`) offers the sla sort on every scope, but
  the unified list scopes (All, Mine, Unassigned, a team) clamp it to most
  recent (`inbox-scope.ts`, `INBOX_UNIFIED_SORTS`; `listInboxItemsFn` has no
  sla sort), so the list silently keeps its recency order. New bug. owner:
  unassigned, review by: 2026-12-03.
- `support/csat.spec.ts` › ratings by email › CSAT-13 an emailed rating link
  (with its rating) opens the page with that face preselected. Every rating
  link in the close and rating-request emails carries `&rating=N`; the router
  parses it as a number and `csat.tsx` validates `rating` as a string, so the
  page answers 500 "Something went wrong" and the customer cannot rate. A link
  without `rating` works. New bug. owner: unassigned, review by: 2026-12-03.
- `support/notifications-email.spec.ts` › SLA emails › SLA-23 the warning
  email is sent without any workflow listening. SLA warning and breach events,
  and so their emails, are only produced while a live workflow uses that
  trigger (`workflow-sweep.ts`). Known bug. owner: unassigned, review by:
  2026-12-03.

### Support suite: tickets

- `support/tickets-create.spec.ts` › TKT-03 the requester gets one email on
  create, not also a reply email echoing the opening note. A customer ticket
  created for a requester (REST, MCP, or the dialog's typeless path) sends the
  "We received your ticket" email and also a conversation reply email
  ("Re: <opening note>"): the opening message is written through the full
  conversation pipeline (`ticket-intake.service.ts:347`,
  `insertTicketMessage` redirected onto the backing conversation), whose
  visitor email is not suppressed for the intake. Same family as the possible
  double email on ticket replies (CUS-O-17). owner: unassigned, review by:
  2026-12-03.
