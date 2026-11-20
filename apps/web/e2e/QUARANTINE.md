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

### Support email journeys (`tests/support/email-*.spec.ts`)

Known bugs (fixes in flight) and bugs found while writing these journeys. Each
test asserts the right behaviour; the working part of each journey is proved
by a separate test that is not quarantined.

### Product suite: roadmap
- `roadmap/admin-roadmap.spec.ts` › RMP-A-16 deleting the selected first
  roadmap moves the board to another roadmap. Product bug:
  `handleDelete` in `apps/web/src/components/admin/roadmap-sidebar.tsx:114`
  re-selects `roadmaps?.[0]?.id` from the list captured before the delete,
  which is the deleted roadmap itself, so the board shows "No roadmap
  selected". Fix: pick the first roadmap whose id is not the deleted one.
  owner: unassigned, review by: 2026-12-03.
- `roadmap/portal-roadmap.spec.ts` › RMP-P-05 a ?roadmap= id the visitor cannot
  see falls back to a roadmap they can. Product bug:
  `apps/web/src/components/public/roadmap-board.tsx:51` keeps
  `effectiveSelectedId` from the URL even when no visible roadmap has it, so a
  hidden or deleted id renders no tab, no columns and no message. Fix: when
  `selectedRoadmap` is undefined, fall back to `availableRoadmaps[0]` (and
  rewrite the param). owner: unassigned, review by: 2026-12-03.
- `roadmap/roadmap-membership.spec.ts` › RMP-E-16 deleting a status takes its
  column off every roadmap that used it. Product bug: `deleteStatus`
  (`apps/web/src/lib/server/domains/statuses/status.service.ts:157`)
  soft-deletes the status but never touches `roadmap_columns`, so every
  roadmap keeps a permanently empty column the builder cannot show or untick.
  Fix: delete the status's `roadmap_columns` rows in the same transaction (or
  refuse while a roadmap uses it). owner: unassigned, review by: 2026-12-03.
