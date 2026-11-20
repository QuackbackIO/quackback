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
- `help-center/feedback.spec.ts` › HC-F-05 a signed-out visitor who flips Yes
  to No is counted once (HC-B2). `recordArticleFeedback`
  (`domains/help-center/help-center.article-feedback.service.ts`) looks up an
  existing vote only when there is a principal; with none it always inserts
  (null principals never collide on the unique index), so Yes then No adds
  one helpful and one not-helpful vote, and every request adds another. Fix:
  have the portal mint an anonymous session before voting (as the widget
  does), or accept the previous `feedbackId` from the client and flip that
  row; add a rate limit either way.
- `help-center/public-access.spec.ts` › HC-P-04 the landing card counts only
  articles the visitor can open (HC-B14). `listPublicCategories`
  (`domains/help-center/help-center.category.service.ts`) rolls
  `recursivePublishedArticleCount` up through every descendant without
  checking that the descendant category is public or that article audiences
  admit the viewer, so a card shows "5 articles" where one can be opened (and
  a category with only hidden content is listed at all). Fix: compute the
  roll-up with the same visibility predicate the collection page uses
  (`helpCenterVisibilityConditions` for the viewer).
- `help-center/widget.spec.ts` › HC-W-10 the first widget vote of a fresh
  visitor confirms it (new bug, `@isolated`). The vote is stored against the
  freshly minted session, but the footer
  (`components/widget/widget-article-footer.tsx`) still says "Was this
  helpful?" and no button is pressed. `cast` calls `ensureSession()` before
  the write; minting the session changes the widget identity, which appears
  to remount the article view (session-keyed queries) and drop the local
  `vote` state. Root cause unconfirmed. Fix: keep the vote state above the
  remount (or key it by article), or mint the session without remounting.
- `help-center/public-locales.spec.ts` › HC-P-27 an untranslated article has
  no French page, and related links on a French page work (HC-B26;
  `@isolated`). `getPublicArticlePageFn` (`lib/server/functions/help-center.ts`)
  loads related articles without the page language, so a French article page
  lists English titles linking to `/hc/fr/articles/<id>-<slug>`, which 404
  when that article has no published French translation. Fix: load related
  articles for the locale (translated only), or link untranslated ones to the
  default-language URL.
### Product suite: API REST (posts and votes)
- `platform/rest-posts.spec.ts` › API-R-026 a PATCH with no recognised field
  is refused to a key that cannot read posts. Product bug: `PATCH
/api/v1/posts/:id` authenticates with a bare `withApiKeyAuth(request)` and
  gates only the fields present (`permissionsForPostPatch`,
  `apps/web/src/routes/api/v1/posts/$postId.ts:31-38`, `:117`), so `{}` (or a
  body of unknown fields such as `boardId`, which zod strips) checks no
  permission and no scope, and `updatePost` returns the whole post. A
  `read:chat` key that `GET /posts/:id` refuses reads any post this way. Fix:
  refuse a body with no updatable field (400), or require
  `post.view_private` (with its scope) on every PATCH. owner: unassigned,
  review by: 2026-12-03.
- `platform/rest-posts.spec.ts` › API-R-027 PATCH tags with an unknown tag id
  is refused and keeps the post's tags. Product bug: `updatePost` deletes every
  tag assignment, then inserts the new set outside a transaction
  (`apps/web/src/lib/server/domains/posts/post.service.ts:480-486`); an
  unknown tag id (foreign key) or a repeated one (primary key) fails the
  insert, the route answers 500 and the post is left with no tags. Fix: check
  the tag ids exist (404) and de-duplicate before deleting, and run the
  delete and insert in one transaction. owner: unassigned, review by:
- `platform/rest-posts.spec.ts` › API-R-012 an unknown or repeated tag id on
  create is refused without leaving a post. Product bug: `createPost` inserts
  the tag assignments without looking the tags up
  (`apps/web/src/lib/server/domains/posts/post.service.ts:271-276`), so an
  unknown tag id or the same id twice answers 500 (no post row is left, the
  insert is in the transaction). Fix: load the tags (non-deleted) and
  de-duplicate first; answer 404 "Tag not found" for a missing one. owner:
  unassigned, review by: 2026-12-03.
- `platform/rest-posts.spec.ts` › API-R-013 a soft-deleted status is not found
  on create or update. Product bug: the status lookups in `createPost` and
  `updatePost` have no `deletedAt` filter
  (`apps/web/src/lib/server/domains/posts/post.service.ts:148`, `:393-394`),
  so a post can be put in a deleted status no list shows. Fix: add
  `isNull(postStatuses.deletedAt)` to both lookups. owner: unassigned, review
  by: 2026-12-03.
- `platform/rest-posts.spec.ts` › API-R-028 a deleted post cannot be edited.
  Product bug: `updatePost` never checks `deletedAt`
  (`apps/web/src/lib/server/domains/posts/post.service.ts:379-383`), so
  `PATCH /api/v1/posts/:id` edits a soft-deleted post and a status change
  emails its subscribers. Fix: treat a deleted post as not found, as votes
  and comments do. owner: unassigned, review by: 2026-12-03.
- `platform/rest-votes.spec.ts` › API-R-041 a proxy vote for an unknown voter
  is a not-found refusal, not a server error. Product bug: `POST
/api/v1/posts/:id/vote/proxy` never looks the voter up
  (`apps/web/src/routes/api/v1/posts/$postId.vote.proxy.ts:43-63`); the vote
  insert hits the principal foreign key and the route answers 500. Fix: look
  the principal up first and answer 404 "User not found". owner: unassigned,
  review by: 2026-12-03.

### Product suite: API REST (comments, moderation, boards, statuses, tags, roadmaps, suggestions, apps)

- `platform/rest-taxonomy.spec.ts` › API-R-072 a status PATCH holding only
  ignored fields answers 200 with nothing changed. Product bug: a body with
  only stripped fields (`slug`, `category`, `position`) leaves `updateData`
  empty and the UPDATE runs with no SET, answering 500
  (`apps/web/src/lib/server/domains/statuses/status.service.ts:131-142`).
  Fix: return the existing row when nothing is set. owner: unassigned, review
  by: 2026-12-03.
- `platform/rest-taxonomy.spec.ts` › API-R-076 a missing tag answers "Tag not
  found". Product bug: `TAG_NOT_FOUND` maps to the public text "PostTag not
  found" (`apps/web/src/lib/server/domains/api/responses.ts:180`). Fix: map it
  to `Tag`. owner: unassigned, review by: 2026-12-03.
- `platform/rest-taxonomy.spec.ts` › API-R-077 deleted boards, statuses and
  tags answer 404 on GET and PATCH. Product bug: the by-id reads and updates
  have no `deletedAt` filter, so a deleted row stays readable and editable
  and the body has no `deletedAt` (`board.service.ts:184-186,321-324`,
  `status.service.ts:103-105,204-207`, `post-tag.service.ts:93-95,165-169`).
  Fix: filter `isNull(deletedAt)` as DELETE already does. owner: unassigned,
  review by: 2026-12-03.
- `platform/rest-roadmaps.spec.ts` › API-R-080 roadmap posts refuse a
  negative offset with 400. Product bug: `offset` is `parseInt`ed with no
  lower-bound guard and `offset=-1` reaches SQL, answering 500
  (`apps/web/src/routes/api/v1/roadmaps/$roadmapId.posts.ts:27-28`). Also seen,
  not asserted: `limit=0` answers no items with `hasMore: true`. Fix:
  validate both as non-negative integers (limit at least 1). owner:
  unassigned, review by: 2026-12-03.
- `platform/rest-roadmaps.spec.ts` › API-R-084 a column with an unknown status
  is refused with a client error. Product bug: the column's `statusId` is not
  looked up, so the foreign key fails and the API answers 500
  (`apps/web/src/lib/server/domains/roadmaps/roadmap.service.ts:339-356`).
  Fix: check the status exists (404 or 400). owner: unassigned, review by:
  2026-12-03.
- `platform/rest-roadmaps.spec.ts` › API-R-085 a column of another roadmap
  cannot be edited or removed through a roadmap's URL. Product bug: column
  PATCH and DELETE validate the roadmap id's format and then ignore it
  (`apps/web/src/routes/api/v1/roadmaps/$roadmapId.columns.$columnId.ts:27-41`).
  Fix: scope the update and delete to `roadmapId`, 404 otherwise. owner:
  unassigned, review by: 2026-12-03.
- `platform/rest-apps.spec.ts` › API-R-092 apps search fills in each post
  status name and colour. Product bug: `statusName` and `statusColor` are
  hard-coded to null (`apps/web/src/routes/api/v1/apps/search.ts:45-46`),
  while `/apps/linked` returns real values. Fix: join `post_statuses`.
  owner: unassigned, review by: 2026-12-03.
- `platform/rest-apps.spec.ts` › API-R-096 linking a deleted or unknown post
  answers 404 and leaves no link row. Product bug: the link row is inserted
  before the post is checked, so a deleted post leaves an orphan link (and a
  404), and an unknown post id answers 500 from the foreign key
  (`apps/web/src/lib/server/integrations/apps/service.ts:53-67`). Fix: load
  the live post first and 404 before inserting. owner: unassigned, review by:
  2026-12-03.
- `platform/rest-apps.spec.ts` › API-R-100 apps error responses carry the
  CORS headers too. Product bug: 401 and 400 answers from `/apps/*` come from
  `handleDomainError` / `badRequestResponse` without
  `Access-Control-Allow-Origin`, so the cross-origin helpdesk iframe cannot
  read them (`apps/web/src/routes/api/v1/apps/boards.ts:34-35`,
  `apps/web/src/lib/server/domains/api/responses.ts:21-33`). Fix: wrap the
  apps error responses with `corsHeaders()`. owner: unassigned, review by:
  2026-12-03.

### Product suite: API REST (changelog, status page, help center, settings, platform)

- `platform/rest-changelog.spec.ts` › API-R-106 a malformed cursor is refused
  as bad input, not a server error. `GET /api/v1/changelog?cursor=not-an-id`
  answers 500 INTERNAL_ERROR: the cursor goes unvalidated into a typeid column
  whose driver throws (`apps/web/src/routes/api/v1/changelog/index.ts:41`,
  `domains/changelog/changelog.query.ts:72`). Fix: validate it with
  `parseTypeId(cursor, 'changelog', 'cursor')` (400). owner: unassigned, review by:
  2026-12-03.
- `platform/rest-changelog.spec.ts` › API-R-111 a body that is not JSON is
  refused as bad input, not a server error. POST and PATCH answer 500:
  `request.json()` throws a plain SyntaxError that `handleDomainError` maps to
  500 (`apps/web/src/routes/api/v1/changelog/index.ts:78`, `$entryId.ts:68`).
  Fix: catch the parse error and answer 400 BAD_REQUEST. owner: unassigned,
  review by: 2026-12-03.
- `platform/rest-status-page.spec.ts` › API-R-127 the services path names a
  service, not a component, in its errors. `GET /api/v1/status/services/nope`
  answers "Invalid component ID format" and a missing one "Status component not
  found" (`apps/web/src/routes/api/v1/status/-service-handlers.ts:148`, `:153`).
  Fix: name the resource "service" on the services path. owner: unassigned,
  review by: 2026-12-03.
- `platform/rest-status-page.spec.ts` › API-R-132 a service id that never
  existed is reported as unknown, not as deleted. A well-formed id that names
  no service gets "An affected service has been deleted. Choose the services
  again." (`apps/web/src/lib/server/domains/status/status.service.ts:137`).
  Fix: tell an unknown id apart from a deleted one. owner: unassigned, review
  by: 2026-12-03.
- `platform/rest-status-page.spec.ts` › API-R-126 a status body that is not
  JSON is refused as bad input, not a server error. POST services and incidents
  answer 500 on an unparsable body (`-service-handlers.ts:94`,
  `status/incidents/index.ts:104`): `request.json()` throws outside
  `handleDomainError`. owner: unassigned, review by: 2026-12-03.
- `platform/rest-help-center.spec.ts` › API-R-165 a malformed categoryId filter
  is refused as bad input. `GET /api/v1/help-center/articles?categoryId=garbage`
  answers 500: the value reaches a typeid column unvalidated
  (`apps/web/src/routes/api/v1/help-center/articles/index.ts:76`). Fix:
  `parseOptionalTypeId(categoryId, 'kb_category', 'category ID')`. owner: unassigned,
  review by: 2026-12-03.
- `platform/rest-help-center.spec.ts` › API-R-166 an article in a malformed or
  unknown category is refused, not a server error. `POST
/api/v1/help-center/articles` with `categoryId` "garbage" or a well-formed
  unknown id answers 500 (`articles/index.ts:21`, no TypeID check; the FK then
  fails). Fix: validate the id and answer 404 "Help center category not found".
  owner: unassigned, review by: 2026-12-03.
- `platform/rest-help-center.spec.ts` › API-R-171 feedback for an unknown article
  is not found, not a server error. The insert violates the
  `kb_article_feedback.article_id` FK: 500
  (`domains/help-center/help-center.article-feedback.service.ts:63`). Fix: check
  the article exists first (404). owner: unassigned, review by: 2026-12-03.
- `platform/rest-help-center.spec.ts` › API-R-163 a help center body that is not
  JSON is refused as bad input. Categories POST/PATCH answer 500 on an
  unparsable body (`categories/index.ts:81`, `$categoryId.ts:91`). owner:
  unassigned, review by: 2026-12-03.

### Product suite: API REST (people and keys)

Each test asserts the right behaviour; the working part of each journey is
proved by a separate test that is not quarantined. Every entry has owner:
unassigned, review by: 2026-12-03.

- `platform/rest-people.spec.ts` › API-R-140 a malformed segmentIds filter is
  a clean 4xx. `segmentIds` is not validated and reaches `inArray` on a typeid
  column: 500 (`routes/api/v1/users/index.ts:41-44`,
  `domains/users/user.service.ts:306-313`).
- `platform/rest-people.spec.ts` › API-R-141 a missing portal user says
  "Portal user not found". `notFoundResponse('Portal user not found')` appends
  " not found" again (`routes/api/v1/users/$principalId.ts:46`).
- `platform/rest-people.spec.ts` › API-R-144 API-R-146 metadata writes on an
  existing user. Every metadata write on an existing user (PATCH `attributes`
  or `externalId`, identify with `attributes`) interpolates the removals array
  into SQL as a parameter list instead of an array: 500 "malformed array
  literal" (`domains/users/user.identify.ts:81`, `:257`).
- `platform/rest-people.spec.ts` › API-R-148 deleting a portal user clears the
  visitor email. `removePortalUser` re-attributes conversations to the
  deleted-user placeholder before it clears `visitor_email` by the old
  principal id, so the email is never cleared
  (`domains/users/user.service.ts:494-499`).
- `platform/rest-people.spec.ts` › API-R-150 a malformed id on the principal
  card. The raw id is queried against a typeid column outside any try: 500
  (`routes/api/v1/users/$principalId.card.ts:53`).
- `platform/rest-people.spec.ts` › API-R-155 a malformed id is listed in
  failed and a non-JSON body is a 400. Both are 500
  (`routes/api/v1/segments/$slug.members.ts:38-41`, `:71`).
- `platform/keys.spec.ts` › API-K-34 a garbage cursor never answers 500.
  Posts, changelog, status incidents and help center articles hand an
  undecodable cursor to their service, which throws: 500.
- `platform/keys.spec.ts` › API-K-35 a users cursor replayed with a different
  limit. The users route turns the offset cursor into a page number, so a new
  limit repeats or skips rows (`routes/api/v1/users/index.ts:47-48`).

### Product suite: API webhooks

- `platform/webhooks-manage.spec.ts` › API-W-09 a deleted webhook reads as
  not found, and API-W-10 a deleted webhook cannot be updated or rotated.
  Product bug: `getWebhookById`, `updateWebhook` and `rotateWebhookSecret`
  look the row up by id only and ignore `deleted_at`
  (`apps/web/src/lib/server/domains/webhooks/webhook.service.ts:127`, `:177`,
  `:229`), so `GET /api/v1/webhooks/{id}` answers 200 for a deleted webhook and
  PATCH and rotate succeed on it (rotate mints a new secret), while the list
  and a second DELETE treat it as gone. Fix: add `isNull(webhooks.deletedAt)`
  to the three `where` clauses, as `deleteWebhook` does. owner: unassigned,
  review by: 2026-12-03.
- `platform/webhooks-manage.spec.ts` › API-W-22 saving an unrelated edit keeps
  a failing webhook's failure count. Product bug: the edit dialog always sends
  `status: 'active'` for an enabled webhook
  (`apps/web/src/components/admin/settings/webhooks/edit-webhook-dialog.tsx:80`)
  and `updateWebhook` resets `failureCount` and `lastError` whenever it gets
  `active` (`webhook.service.ts:171`), so changing only the events hides a
  failing endpoint. The switch copy promises a reset only when an
  auto-disabled webhook is turned back on. Fix: send `status` only when the
  switch changed, or reset the counters only on a disabled-to-active change.
  owner: unassigned, review by: 2026-12-03.
- `platform/webhooks-feedback.spec.ts` › API-W-48 post.deleted says who deleted
  the post. Product bug: `softDeletePost` dispatches `post.deleted` with an
  actor built from ids only
  (`apps/web/src/lib/server/domains/posts/post.user-actions.ts:332`), and the
  payload's `deletedBy` reads `actor.email || actor.displayName`
  (`apps/web/src/lib/server/events/dispatch.ts:265`), so it is always missing.
  Fix: pass the deleter's email and display name into `buildEventActor` there.
  owner: unassigned, review by: 2026-12-03.

### Product suite: API MCP

Each test asserts the right behaviour; the working part of each journey is
proved by a separate test that is not quarantined where one exists.

- `platform/mcp-auth.spec.ts` › MCP OAuth consent › API-M-22 authorizing Full
  access yields a token that writes; API-M-23 authorizing a step-up grants
  exactly the selection; API-M-24 the Read only choice yields a token that
  reads but is stepped up on a write; API-M-26 Deny returns to the client with
  access_denied. Product bug: every consent submit (Authorize and Deny)
  answers 400 `invalid_signature`. Better Auth 1.7.26 (bumped in #1099) signs
  the consent query with repeated `ba_param` entries; the TanStack router
  rewrites the URL on hydration and turns them into one JSON array
  (`ba_param=["ba_iat",...]`), and `handleConsent` posts
  `window.location.search` as `oauth_query`
  (`apps/web/src/routes/oauth/consent.tsx` handleConsent), so the signature no
  longer matches. Expanding the JSON array back into repeated `ba_param`
  values before posting made the full flow pass locally. owner: unassigned,
  review by: 2026-12-03.
- `platform/mcp-feedback.spec.ts` › MCP resources › API-M-34 a portal user's
  OAuth token does not read team-only boards, internal tags, team roadmaps or
  the team roster. Product bug: the boards, tags, roadmaps and members
  resources have no team-role check (`apps/web/src/lib/server/mcp/server.ts`
  registerResources); only help-center categories checks it. Reachable with
  portal MCP access on. owner: unassigned, review by: 2026-12-03.
- `platform/mcp-feedback.spec.ts` › API-M-55 a portal user's create_post takes
  the board default status and no tags. Product bug: `create_post` passes
  `statusId` and `tagIds` through for portal users
  (`apps/web/src/lib/server/mcp/tools/posts.ts` create_post handler) and
  `createPost` applies them; the portal never lets a customer choose either.
  owner: unassigned, review by: 2026-12-03.
- `platform/mcp-content.spec.ts` › API-M-73 publishing an already published
  entry keeps its date. Product bug: `update_changelog({ publish: true })`
  resets `publishedAt` to now (`apps/web/src/lib/server/mcp/tools/changelog.ts`
  update_changelog maps `publish: true` to `{ type: 'published' }`). Fixed by
  open PR #812. owner: unassigned, review by: 2026-12-03.
- `platform/mcp-settings.spec.ts` › API-M-88 update_settings does not change the
  changelog area without write:changelog. Product bug: MCP `update_settings`
  calls `changeSettingsArea({ actor })` without `assertAreaScope`
  (`apps/web/src/lib/server/mcp/tools/settings.ts`), so `write:settings` alone
  changes the changelog area that REST refuses without `write:changelog`.
  owner: unassigned, review by: 2026-12-03.
- `platform/mcp-settings.spec.ts` › API-M-93 the admin setup guide's tool list
  matches the server's. Product bug: the page hard-codes 22 tools including
  `list_suggestions`, which the server does not register, against 43 served
  (`apps/web/src/components/admin/settings/mcp/mcp-setup-guide.tsx`
  `MCP_TOOLS`). owner: unassigned, review by: 2026-12-03.

### Product suite: status page

Each test asserts the right behaviour. Where the rest of a journey works, a
separate test that is not quarantined proves it (STA-A-30 and STA-S-23 have
no such part beyond the wrong notification).

- `status/admin-incidents.spec.ts` › STA-A-30 an incident created already
  resolved announces nothing. `createIncident` sets
  `notifySubscribers = !backfilled && (input.notifySubscribers ?? true)`
  (`apps/web/src/lib/server/domains/status/status.service.ts:242`) without
  looking at the status, so a non-backfill incident created `resolved` (or a
  window created `completed`) writes `status.incident_created` and emails
  subscribers "New incident reported" for something already over. Fix: treat a
  terminal create status like a backfill for notification (no event, no
  email). owner: unassigned, review by: 2026-12-03.
- `status/admin-incidents.spec.ts` › STA-A-33 editor deep link to a malformed
  id says not found. `getStatusIncidentAdminFn` passes the raw id to
  `findStatusIncidentById`
  (`apps/web/src/lib/server/domains/status/status.service.ts:866`), whose
  TypeID conversion throws, so the fn errors ("Something went wrong on our
  side") and the editor shows "Couldn't load this incident" with Try again.
  Fix: return null for an id that fails `isTypeId(id, 'status_incident')`, as
  the public path does. owner: unassigned, review by: 2026-12-03.
- `status/admin-maintenance.spec.ts` › STA-A-46 a maintenance window with no
  dates is refused. `createIncident`
  (`apps/web/src/lib/server/domains/status/status.service.ts:183`) and the
  REST create accept `kind: 'maintenance'` with no `scheduledStartAt` or
  `scheduledEndAt`: no job is ever enqueued, so the window stays "scheduled"
  (and in Upcoming maintenance) forever, and its email reads "<blank> to
  <blank>". The schedule dialog requires both bounds for exactly this reason.
  Fix: refuse a maintenance create without both bounds (VALIDATION_ERROR).
  owner: unassigned, review by: 2026-12-03.
- `status/admin-templates.spec.ts` › STA-A-49 a blank template name is
  refused with the Name field named. The template name goes through
  `validateTitle` (`apps/web/src/lib/server/domains/status/status.service.ts:1161`
  and `:1191`), so a blank name is refused with "Title is required" (and a long
  one with "Title must not exceed 200 characters") while the field is "Template
  name". Fix: a `validateName`-style check with "Name is required". owner:
  unassigned, review by: 2026-12-03.
- `status/admin-subscribers.spec.ts` › STA-A-53 every row of a large import is
  listed across pages. A CSV import inserts every row in one transaction, so
  they share one `created_at`; `listStatusSubscriptions` orders by `created_at`
  only and pages with `created_at < cursor`
  (`apps/web/src/lib/server/domains/status/status.subscription.ts:210`, `:236`),
  so page 2 skips the rest of the import (35 imported, 30 listed; the export
  has all 35). Fix: order by `(created_at, id)` and page on the pair. owner:
  unassigned, review by: 2026-12-03.
- `status/admin-overview.serial.spec.ts` › STA-A-57 the overview banner shows
  what visitors see. `getStatusOverviewAdminFn` derives `topLevelStatus` from
  every service (`apps/web/src/lib/server/functions/status.ts:624`), segment
  gated and plan hidden ones included, so with only a gated service down the
  "Visitors currently see" banner says "Major system outage" while anonymous
  visitors see "All systems operational". Fix: derive it from the anonymous
  projection (`getStatusPageSnapshot(ANONYMOUS_ACTOR, …).topLevel`), or relabel
  the banner. owner: unassigned, review by: 2026-12-03.
