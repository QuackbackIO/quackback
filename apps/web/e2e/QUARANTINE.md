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
- Vitest `it.fails` (fails today, passes once fixed, then flip it to `it`),
  under `apps/web/src/lib/server/domains/roadmaps/__tests__/`:
  - `roadmap-slug-reuse.test.ts` › RMP-A-05 a deleted roadmap frees its slug
    for a new one. The slug check in `createRoadmap` ignores `deletedAt`
    (`roadmap.service.ts:143`), and `roadmaps_slug_unique` is not partial
    (`packages/db/src/schema/boards.ts:71`), so a deleted roadmap keeps its
    name and slug forever. Fix: filter `isNull(deletedAt)` and make the
    unique index partial (`WHERE deleted_at IS NULL`), as segments do.
  - `roadmap-columns.test.ts` › RMP-A-12 refuses a second column for a status
    the roadmap already has / refuses renaming a column to whitespace.
    `createRoadmapColumn` (`roadmap.service.ts:339`) skips the duplicate-status
    check that the bulk path's `validateColumns` does, so only the DB unique
    index stops it, as a raw error. `updateRoadmapColumn` (`:358`) trims the
    name but never rejects an empty result. Fix: reuse `validateColumns`'
    checks on both single-column paths.

  owner: unassigned, review by: 2026-12-03.
### Product suite: people (users and companies)
- `people/users.spec.ts` › removing a person › PPL-U-43 removing a voter
  withdraws their vote from the post count. Product bug: `removePortalUser`
  deletes the principal and lets `post_votes` cascade
  (`apps/web/src/lib/server/domains/users/user.service.ts:514`), but nothing
  decrements `posts.vote_count`, so every post the person voted on keeps a
  count one too high on the portal and the admin, although the remove dialog
  promises "their votes are withdrawn". Fix: in the same transaction, before
  the delete, `UPDATE posts SET vote_count = greatest(vote_count - 1, 0) WHERE
id IN (SELECT post_id FROM post_votes WHERE principal_id = $1)`. owner:
  unassigned, review by: 2026-12-03.
- `people/users-api.spec.ts` › REST /api/v1/users › PPL-U-59 a teammate id
  answers a plain "Portal user not found". Product bug: the route passes a
  full sentence to `notFoundResponse`, which appends " not found" again, so
  the answer reads "Portal user not found not found"
  (`apps/web/src/routes/api/v1/users/$principalId.ts:46`). Fix: pass
  `'Portal user'`. owner: unassigned, review by: 2026-12-03.
- `people/users-api.spec.ts` › REST /api/v1/users › PPL-U-64 an unknown or
  teammate id is refused as a missing user, not a "Member". Product bug:
  `removePortalUser` throws `MEMBER_NOT_FOUND`, which `handleDomainError` maps
  to "Member not found" (`apps/web/src/lib/server/domains/api/responses.ts:182`),
  so DELETE /api/v1/users/:id on an unknown portal user talks about a member.
  Fix: throw a `USER_NOT_FOUND` (or a portal-user code) from
  `removePortalUser` (`user.service.ts:476`), or map the error in the route.
  owner: unassigned, review by: 2026-12-03.
- `people/users.spec.ts` › merging a lead › PPL-U-31 merging a lead that
  voted the same post as the user leaves one vote counted. Product bug: the
  `post_votes` step of the re-point registry is a `collisionRepoint` that
  drops the lead's colliding vote (the user's vote wins)
  (`apps/web/src/lib/server/domains/principals/principal-repoint.ts:220`)
  without decrementing `posts.vote_count`, so the post keeps one vote too
  many. Fix: in that step, decrement `posts.vote_count` for every dropped
  vote row (or recompute the count for the affected posts). owner:
  unassigned, review by: 2026-12-03.
- `people/users-api.spec.ts` › REST /api/v1/users › PPL-U-60 PATCH merges
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
  with a guard for the empty case. owner: unassigned, review by: 2026-12-03.
- `people/companies.spec.ts` › PPL-C-03 a company the admin creates is not
  labelled as API-sourced. Product bug: `createCompanyFn`'s schema has no
  `source` and the admin UI sends none, so `createCompany` falls back to
  `source: input.source ?? 'api'`
  (`apps/web/src/lib/server/domains/companies/company.service.ts:94`) and
  every company made in the admin (directory "New company", a person's
  Company card "Create") shows the "API" badge. Fix: have `createCompanyFn`
  (`apps/web/src/lib/server/functions/companies.ts`) pass `source: 'manual'`.
  owner: unassigned, review by: 2026-12-03.
- `people/companies.spec.ts` › PPL-C-31 a duplicate company attribute key is
  refused and the dialog says so. Product bug: `handleCreate` awaits
  `onCreate` with no catch
  (`apps/web/src/components/admin/settings/scalar-attribute-list.tsx:299`) and
  the mutation hook has no `onError`, so the server's 409 `DUPLICATE_KEY`
  "An attribute with that key already exists" never surfaces: the dialog
  just stays open. Same component backs user attributes (PPL-U-51). Fix:
  catch in `handleCreate` (and the edit/delete handlers) and toast the
  error message. owner: unassigned, review by: 2026-12-03.
### Product suite: help center
Each test asserts the right behaviour and fails on the product bug named.
owner: unassigned, review by: 2026-12-03 for every entry.
- `help-center/admin-articles.spec.ts` › HC-A-15 emptying the description in
  the editor clears it (HC-B12). `article-modal.tsx` sends
  `description: data.description?.trim() || undefined`, and `updateArticle`
  (`help-center.article.service.ts`) treats `undefined` as "leave unchanged",
  so the old description stays. Fix: send `''` (or `null`) for an emptied
  field; the service already stores `'' || null` as null.
- `help-center/admin-articles.spec.ts` › HC-A-20 an unknown article id in the
  URL says the article was not found (HC-B18). `use-url-modal.ts` opens the
  dialog whenever `?article=` is set and `article-modal.tsx` renders a spinner
  until the article loads, so a missing or deleted id spins forever. Fix: when
  the detail query errors (ARTICLE_NOT_FOUND), show a not-found state or close
  the modal and drop the param.
- `help-center/api-rest.spec.ts` › HC-A-16 a whitespace-only title or
  category name is refused on update (HC-B13). `updateArticleSchema` and
  `updateCategorySchema` (`lib/shared/schemas/help-center.ts`, and the REST
  bodies) check `min(1)` before trimming; `updateArticle` / `updateCategory`
  then store the trimmed empty string. Fix: `.trim().min(1)` in the update
  schemas, or refuse an empty trimmed value in the services as create does.
- `help-center/api-rest.spec.ts` › HC-A-76 a key without help_center.manage
  cannot read drafts or private categories (HC-B3). The GET handlers in
  `routes/api/v1/help-center/articles/index.ts`, `articles/$articleId.ts`,
  `categories/index.ts` and `categories/$categoryId.ts` call
  `withApiKeyAuth(request)` with no permission and read at team scope, so a
  Contributor's key gets drafts and private categories. Fix: pass
  `{ permission: PERMISSIONS.HELP_CENTER_MANAGE }` (as MCP does), or read with
  the public visibility rules for keys without it.
- `help-center/admin-trash.spec.ts` › HC-A-26 the delete dialogs say a
  deleted article or category can be restored (HC-B5). The article confirm
  (`components/admin/help-center/help-center-list.tsx`, ConfirmDialog
  description) says "This action cannot be undone. The article will be
  permanently deleted." and the category confirm says "the UI provides no
  restore flow", but both are soft deletes that Other › Deleted items restores
  for 30 days. Fix: reword both to point at Deleted items.
- `help-center/admin-settings.spec.ts` › HC-A-67 a protocol-relative header
  link is refused (HC-B20; `@isolated`). `helpCenterHeaderLinkUrl`
  (`lib/shared/schemas/help-center.ts`) accepts any value starting with `/`,
  so `//example.com` is stored, and `components/public/portal-header.tsx`
  decides "external" by `!startsWith('/')`, rendering it as an in-tab internal
  link to another host. Fix: require `startsWith('/') && !startsWith('//')`
  in the schema (and treat `//` as external in the header).
- `help-center/translations.spec.ts` › HC-A-53 Save draft on a published
  translation does not change the live page (HC-B9; `@isolated`). The
  dialog's Save draft (`components/admin/help-center/article-translations-dialog.tsx`)
  calls `upsertArticleTranslationFn`, which never touches `status`, so a
  published translation's live text changes at once. Fix: either set
  `status: 'draft'` on that save, or label the button "Save" when the
  translation is published.
- `help-center/public-pages.spec.ts` › HC-P-33 reading the canonical article
  page counts a view (HC-B1). `view_count` is incremented only in
  `getPublicArticleBySlug` (`domains/help-center/help-center.article.service.ts`),
  which serves the legacy URLs, the widget's slug opens, embed cards and the
  admin View button. The canonical `/hc/<locale>/articles/<urlId>-<slug>` page
  uses `getPublicArticleByUrlId`, which never counts, so the list "N views",
  the performance table and Popular articles miss real reads. Fix: count in
  the canonical page's loader (and decide whether previews/embeds count).
