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
- Every quarantined test has an entry below that names its fix and a review
  date. On the review date, fix the test, fix the product, or delete the test
  with a reason. Do not extend the date without a reason in the entry.

## The rule: every entry names its fix

- An entry starts with the journey ids and the fix, on one line:

  ```md
  - FBA-I-11 · fix: #1223
    `feedback/admin-inbox.spec.ts` › what the test asserts, and why it fails.
  ```

  The fix is the PR that fixes the cause, or the issue that tracks it: `#NNN`
  or a GitHub issue or pull request URL. "Product bug, not yet filed" is not a
  fix: open an issue (`e2e quarantine: <short cause>`) and name it. One issue
  can cover several ids that share a cause.

- The fix PR lifts the quarantine: it removes the `@quarantine` tag, the
  `quarantine` annotation and the entry, in the same PR. When a fix lands
  without the lift, the entry keeps the PR and adds the issue that tracks
  the lift (`fix: #1223 (merged); lift: #1242`).
- A review date no more than two weeks out. One extension of up to two weeks
  is allowed, with the reason written in the entry. A second extension needs
  the code owner's sign-off in the PR.
- `src/lib/server/e2e-harness/__tests__/quarantine-ledger.test.ts` runs in the
  unit suite on every PR. It fails, naming the ids, when a test tagged
  `@quarantine` has no entry, when an entry matches no quarantined test (a
  lift that left its entry behind), or when an entry names no fix. A
  quarantined test needs its journey id at the start of its title.
- The nightly `e2e-quarantine` summary lists every quarantined test, so a test
  that has started to pass, or one past its date, is visible every morning.
- The support suite (`playwright.support.config.ts`) follows the same rule and
  tag; its nightly run leaves `@quarantine` out in the same way.

## Quarantined tests

### Product suite: people (users and companies)

- PPL-U-64 · fix: #1240
  `people/users-api.spec.ts` › REST /api/v1/users › PPL-U-64 an unknown or
  teammate id is refused as a missing user, not a "Member". Product bug:
  `removePortalUser` throws `MEMBER_NOT_FOUND`, which `handleDomainError` maps
  to "Member not found" (`apps/web/src/lib/server/domains/api/responses.ts:182`),
  so DELETE /api/v1/users/:id on an unknown portal user talks about a member.
  Fix: throw a `USER_NOT_FOUND` (or a portal-user code) from
  `removePortalUser` (`user.service.ts:476`), or map the error in the route.
  review by: 2026-12-03.
- PPL-U-60 PPL-U-61 PPL-U-66 · fix: #1193 (issue #886)
  `people/users-api.spec.ts` › REST /api/v1/users › PPL-U-60 PATCH merges
  coerced attributes, unsets null keys and sets the external id; PPL-U-61
  boolean and date attributes accept their valid spellings; PPL-U-66
  identify merges an attribute into an existing user, keeping the others.
  Product bug: every attribute or `externalId` write on an EXISTING user over
  REST (PATCH /api/v1/users/:id and identify of a known email) answers 500.
  `user.identify.ts:81` and `:257` build
  `... ::jsonb - ${metadataRemovals}::text[]`; drizzle expands a JS array in
  a `sql` template into a parameter list, so the SQL is `- ()::text[]`
  (syntax error) with no removals and `- ($4)::text[]` (malformed array
  literal) with one. Creating a user through identify is unaffected. Fix:
  bind the array as one parameter, e.g.
  `- ${sql.param(metadataRemovals)}::text[]` or
  `- ARRAY[${sql.join(metadataRemovals.map((k) => sql`${k}`), sql`, `)}]::text[]`
  with a guard for the empty case. review by: 2026-12-03.

### Product suite: API REST (people and keys)

Each test asserts the right behaviour; the working part of each journey is
proved by a separate test that is not quarantined. Every entry has review by:
2026-12-03.

- API-R-144 API-R-146 · fix: #1193 (issue #886)
  `platform/rest-people.spec.ts` › API-R-144 API-R-146 metadata writes on an
  existing user. Every metadata write on an existing user (PATCH `attributes`
  or `externalId`, identify with `attributes`) interpolates the removals array
  into SQL as a parameter list instead of an array: 500 "malformed array
  literal" (`domains/users/user.identify.ts:81`, `:257`).

### Product suite: API MCP

Each test asserts the right behaviour; the working part of each journey is
proved by a separate test that is not quarantined where one exists.

- API-M-73 · fix: #812
  `platform/mcp-content.spec.ts` › API-M-73 publishing an already published
  entry keeps its date. Product bug: `update_changelog({ publish: true })`
  resets `publishedAt` to now (`apps/web/src/lib/server/mcp/tools/changelog.ts`
  update_changelog maps `publish: true` to `{ type: 'published' }`). Fixed by
  open PR #812. review by: 2026-12-03.

### Product suite: FBP feed, submit and voting

- FBP-V-14 · fix: #1241
  `feedback/portal-voting.spec.ts` › FBP-V-14 after a vote collision the post
  count equals its distinct voters (FBP-B15). When an anonymous visitor who
  voted signs in to an account that also voted on the same post, the re-point
  step drops the colliding anonymous vote
  (`apps/web/src/lib/server/domains/principals/principal-repoint.ts:220-225`)
  but `mergeAnonymousToIdentified`
  (`apps/web/src/lib/server/auth/merge-anonymous.ts:40-62`) never recounts, so
  `posts.vote_count` stays one above the number of voters (red run: expected
  1, received 2). Smallest fix: inside the merge transaction recompute
  `vote_count` from `post_votes` for every post the dropped votes touched.
  Runs in product-isolated (needs the widget on). review
  by: 2026-12-03.
