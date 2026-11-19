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

### Storage is now wired; the sent attachment's rendering is not traced

Since #629, conversation attachments upload to `/api/upload/file` (team) and
`/api/widget/files` (widget) and become file records in object storage. The
e2e-full and e2e-quarantine jobs now run an S3-compatible storage container.
With it (checked locally against the same container) the upload works: the
tray thumb renders and the stored file reads back with a 200. The tests then
fail after the reply is sent: they wait for the sent image as an
`img.object-contain` thumb, and the thread showed it as a file link instead.
The thread renders a single image that way (`ImageRow` in
`attachment-list.tsx`), so either the sent file is not classed as an image
here or the assertions are stale; not traced. The paperclip label
(`Attach files`) and an image-load wait were fixed on the way.

- `admin/conversation-images.spec.ts` › Admin conversation images › paste and
  paperclip stage the tray, then send a contain thumb. owner: unassigned,
  review by: 2026-12-02.
- `admin/conversation-images.spec.ts` › Local Vite storage serves conversation
  thumbs › real paste thumb still decodes after a full page refresh. owner:
  unassigned, review by: 2026-12-02.
- `widget/conversation-images.spec.ts` › Widget conversation images › paste and
  attach land in the tray, then render a contain thumb + zoom. owner:
  unassigned, review by: 2026-12-02.

### Needs a reachable OIDC discovery document (environment, and a suspected product bug)

- `auth/unified-login.spec.ts` › (4) /?auth=signin shows the dialog with OIDC
  button and recovery-code link. The seeded provider's discovery URL cannot be
  reached, so the provider is skipped. With password and magic link turned off,
  `GET /` then fails with "Provider not found" and shows the error page. The
  page should fall back instead of failing. This failed every time locally,
  also with the file run alone, but passed on its own in the first CI
  quarantine run, so the cause is not confirmed. owner: unassigned, review by:
  2026-12-02.

### Suspected product bugs

- `admin/settings-team.spec.ts` › add people dialog cancel closes the dialog.
  With the People field focused (it focuses itself when the dialog opens), the
  first click on Cancel does not close the Add people dialog; a second click
  does. The dialog code (`add-people-dialog.tsx`) looks right, so the
  combobox's blur or outside-click handling may take the first click. It
  failed in its file locally but passed on its own in the first CI quarantine
  run, so the cause is not confirmed. owner: unassigned, review by:
  2026-12-02.
- `public/post-submission.spec.ts` › Board Selector › board selector defaults to
  filtered board when filter is active. On a direct load of `/?board=features`
  the composer does not open on the first attempt, even after 15 seconds of
  clicks; the retry passes. Not traced; possibly a hydration race in the
  composer. It passed on its own in the first CI quarantine run. owner:
  unassigned, review by: 2026-12-02.

### Needs a product decision

- `public/notifications.spec.ts` › Portal Notifications (unauthenticated) ›
  redirects away from /notifications when not logged in. A signed-out visitor
  sees the Notifications page heading. The route has never had an auth guard,
  so decide whether it should redirect, show a sign-in gate, or stay as it is.
  owner: unassigned, review by: 2026-12-02.

### Not traced

- `public/comments.spec.ts` › Markdown comment rendering › uploading an image
  into a comment renders it in the thread. Typing `/image` in the comment
  composer shows no Image option for the signed-in teammate. The comment
  editor turns images on and the post page passes an upload handler, so the
  cause is somewhere between them. owner: unassigned, review by: 2026-12-02.

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
