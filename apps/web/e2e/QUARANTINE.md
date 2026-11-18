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

## Quarantined tests

Every entry has owner: unassigned and review by: 2026-12-02.

### Needs object storage in CI (environment)

Since #629, conversation attachments upload to `/api/upload/file` (team) and
`/api/widget/files` (widget) and become file records in object storage. A
route stub cannot stand in for that: the send step attaches files by id, and
the server reads their rows. CI has no object storage, so the tray shows "File
storage is not configured". These come back when the e2e jobs get a storage
service.

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
