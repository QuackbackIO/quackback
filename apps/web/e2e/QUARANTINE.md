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

### Product suite: people (users and companies)

- `people/users-api.spec.ts` › REST /api/v1/users › PPL-U-64 an unknown or
  teammate id is refused as a missing user, not a "Member". Product bug:
  `removePortalUser` throws `MEMBER_NOT_FOUND`, which `handleDomainError` maps
  to "Member not found" (`apps/web/src/lib/server/domains/api/responses.ts:182`),
  so DELETE /api/v1/users/:id on an unknown portal user talks about a member.
  Fix: throw a `USER_NOT_FOUND` (or a portal-user code) from
  `removePortalUser` (`user.service.ts:476`), or map the error in the route.
  owner: unassigned, review by: 2026-12-03.
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

### Product suite: help center

Each test asserts the right behaviour and fails on the product bug named.
owner: unassigned, review by: 2026-12-03 for every entry.

- `help-center/api-rest.spec.ts` › HC-A-76 a key without help_center.manage
  cannot read drafts or private categories (HC-B3). The GET handlers in
  `routes/api/v1/help-center/articles/index.ts`, `articles/$articleId.ts`,
  `categories/index.ts` and `categories/$categoryId.ts` call
  `withApiKeyAuth(request)` with no permission and read at team scope, so a
  Contributor's key gets drafts and private categories. Fix: pass
  `{ permission: PERMISSIONS.HELP_CENTER_MANAGE }` (as MCP does), or read with
  the public visibility rules for keys without it.
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

### Product suite: API REST (people and keys)

Each test asserts the right behaviour; the working part of each journey is
proved by a separate test that is not quarantined. Every entry has owner:
unassigned, review by: 2026-12-03.

- `platform/rest-people.spec.ts` › API-R-144 API-R-146 metadata writes on an
  existing user. Every metadata write on an existing user (PATCH `attributes`
  or `externalId`, identify with `attributes`) interpolates the removals array
  into SQL as a parameter list instead of an array: 500 "malformed array
  literal" (`domains/users/user.identify.ts:81`, `:257`).

### Product suite: API MCP

Each test asserts the right behaviour; the working part of each journey is
proved by a separate test that is not quarantined where one exists.

- `platform/mcp-content.spec.ts` › API-M-73 publishing an already published
  entry keeps its date. Product bug: `update_changelog({ publish: true })`
  resets `publishedAt` to now (`apps/web/src/lib/server/mcp/tools/changelog.ts`
  update_changelog maps `publish: true` to `{ type: 'published' }`). Fixed by
  open PR #812. owner: unassigned, review by: 2026-12-03.

### Product suite: FBP feed, submit and voting

- `feedback/portal-voting.spec.ts` › FBP-V-14 after a vote collision the post
  count equals its distinct voters (FBP-B15). When an anonymous visitor who
  voted signs in to an account that also voted on the same post, the re-point
  step drops the colliding anonymous vote
  (`apps/web/src/lib/server/domains/principals/principal-repoint.ts:220-225`)
  but `mergeAnonymousToIdentified`
  (`apps/web/src/lib/server/auth/merge-anonymous.ts:40-62`) never recounts, so
  `posts.vote_count` stays one above the number of voters (red run: expected
  1, received 2). Smallest fix: inside the merge transaction recompute
  `vote_count` from `post_votes` for every post the dropped votes touched.
  Runs in product-isolated (needs the widget on). owner: unassigned, review
  by: 2026-12-03.

### Product suite: FBP comments and notifications


### Product suite: FBP access, widget and profile

- `status/api.spec.ts` › STA-X-06 incident list paging answers bad limits and
  cursors cleanly. `GET /api/v1/status/incidents` parses `limit` with
  `parseInt` itself (`apps/web/src/routes/api/v1/status/incidents/index.ts:64`)
  instead of the shared pagination guard: `limit=0` answers an empty page with
  `hasMore: true` and no cursor, and a negative or non-numeric limit or a
  garbage cursor reaches the database. Fix: use `parsePaginationParams` and
  refuse a cursor that is not a status incident id. owner: unassigned, review
  by: 2026-12-03.

### Product suite: people sign-in and security (PPL-AUTH)

- `people/auth-portal.spec.ts` › PPL-AUTH-09 a reused or expired sign-in link
  says it expired. Product bug A-B1: the library redirects a spent or expired
  link with `error=INVALID_TOKEN` (uppercase), and the toast map only knows the
  lowercase `invalid_token` / `token_expired`
  (`apps/web/src/lib/shared/auth-block-messages.ts:74`,
  `apps/web/src/components/auth/use-auto-open-auth.ts:37`), so the person sees
  the generic "Sign-in failed. Try again or contact your administrator..."
  toast. Fix: map `INVALID_TOKEN` (and `EXPIRED_TOKEN`) to the expired-link
  copy. owner: unassigned, review by: 2026-12-03.
- `people/auth-methods.spec.ts` › PPL-AUTH-24 a code refused by the sign-in
  limit says to wait, not that the code is wrong. Product bug A-B6:
  `/sign-in/email-otp` spends the same `signin:magiclink:<ip>:<email>` bucket
  as the email send (`apps/web/src/lib/server/auth/hooks.ts:110`, `:230`), so
  send + resend + one more send leaves the right code refused with 429
  `rate_limited`, and `useEmailSignin`
  (`apps/web/src/components/auth/use-email-signin.ts:113`) maps that to
  "That code isn't right". Fix: map `rate_limited` to the wait copy (whether
  code entry should share the send budget is an owner question). Runs in
  product-isolated. owner: unassigned, review by: 2026-12-03.
- `people/auth-invites.spec.ts` › PPL-AUTH-201 accepting, then revisiting, an
  invite lands on the portal. Product bug (new): the invite page's loader
  re-throws redirects only when `'isRedirect' in err`
  (`apps/web/src/routes/portal-invite.$inviteId.tsx:53`), but the router's
  `redirect()` is a `Response` carrying `options` and no `isRedirect`
  property, so the redirect to `/` after a successful accept (and on every
  revisit) is swallowed and the invitee sees "Something went wrong". The
  invite is accepted all the same. Fix: use the router's `isRedirect(err)`.
  owner: unassigned, review by: 2026-12-03.

### Product suite: feedback admin (inbox and posts)

- `feedback/admin-inbox.spec.ts` › FBA-I-11 Responded lists posts with a public
  team reply; a private note is not a response. Product bug: the Team response
  filter (and its counts) treats a private internal note as a response, because
  `teamResponseExistsSql` (`apps/web/src/lib/server/domains/posts/post.inbox.ts:43`)
  matches any live comment with `is_team_member = true`. Fix: add
  `AND post_comments.is_private = false` (and `moderation_state <> 'pending'`)
  to that EXISTS. owner: unassigned, review by: 2026-12-03.
- `feedback/admin-inbox.spec.ts` › FBA-I-12 Has duplicates lists only posts with a
  pending suggestion, and nothing when none has one. Product bug: the filter
  runs in the browser (`feedback-table-view.tsx:244`) and is skipped when the
  counts map is `undefined`, which `inbox-container.tsx:85` returns whenever no
  loaded post has a pending suggestion, so every post is listed. Fix: filter on
  the server (`hasDuplicates` in `post.inbox.ts`), or treat a missing map as
  "no post has duplicates" when the filter is on. owner: unassigned, review by:
- `feedback/admin-inbox.spec.ts` › FBA-I-32 a failed list read shows Failed to
  load feedback, and Try again recovers. Product bug: the error component's Try
  again (`apps/web/src/routes/admin/feedback.index.tsx:71`) calls only the error
  boundary's `reset`, so the failed loader is never re-run and the alert stays
  until a full reload. Fix: `onClick={() => { router.invalidate(); reset() }}`
  (or `useQueryErrorResetBoundary`). owner: unassigned, review by: 2026-12-03.
- `feedback/admin-post-actions.spec.ts` › FBA-P-04 a post created over REST
  without a status gets the workspace default status (`@isolated`). Product
  bug: `createPost` falls back to the status slugged `open`
  (`apps/web/src/lib/server/domains/posts/post.service.ts:145`), not the one
  marked default, so REST, MCP and Track as feedback ignore a changed default
  while the portal and admin dialog follow it. Fix: look up
  `is_default = true` there (falling back to `open`). owner: unassigned,
  review by: 2026-12-03.
- `feedback/admin-post-actions.spec.ts` › FBA-P-08 choosing the status a post
  already has changes nothing. Product bug: `changeStatus`
  (`apps/web/src/lib/server/domains/posts/post.status.ts:72`) has no
  same-status guard, so re-picking the current status writes a
  `status.changed` activity, fires `post.status_changed` (Open to Open) and
  emails subscribers. Fix: return early when the post already has `statusId`.
  owner: unassigned, review by: 2026-12-03.
- `feedback/admin-post-actions.spec.ts` › FBA-P-11 a post owner must be a
  teammate. Product bug: `setPostOwnerFn`
  (`apps/web/src/lib/server/functions/posts.ts:497`) accepts any principal
  id, so a customer can be made owner (and gets the owner bell). Fix: load the
  principal and refuse unless its role is admin or member. owner: unassigned,
  review by: 2026-12-03.
- `feedback/admin-post-actions.spec.ts` › FBA-P-17 post.deleted from the post
  modal names who deleted it. Product bug: `softDeletePost` builds the event
  actor from principal and user ids only
  (`apps/web/src/lib/server/domains/posts/post.user-actions.ts:332`), so
  `dispatchPostDeleted` (`apps/web/src/lib/server/events/dispatch.ts:265`)
  finds no email or name and the webhook carries no `deletedBy`. Fix: pass the
  actor's email and display name into `buildEventActor`. owner: unassigned,
  review by: 2026-12-03.
- `feedback/admin-post-actions.spec.ts` › FBA-P-21 deleting a canonical post
  does not hide its merged duplicates. Product bug: `softDeletePost`
  (`apps/web/src/lib/server/domains/posts/post.user-actions.ts:243`) only
  recounts when the deleted post is itself a duplicate; the duplicates of a
  deleted canonical keep `canonical_post_id`, and the inbox hides every such
  post (`apps/web/src/lib/server/domains/posts/post.inbox.ts:100`). Fix:
  unmerge (or re-point) the duplicates when a canonical is deleted. owner:
  unassigned, review by: 2026-12-03.
- `feedback/admin-post-comments.spec.ts` › FBA-P-30 a teammate without
  post.set_status cannot change status through a comment. Product bug:
  `createComment` applies `statusId` for any team author
  (`apps/web/src/lib/server/domains/comments/comment.service.ts:146`) and
  `createCommentFn` checks no status permission, so a role without
  post.set_status changes status through the comment box. Fix: require
  post.set_status for `shouldChangeStatus`. owner: unassigned, review by:
  2026-12-03.
- `feedback/admin-inbox.spec.ts` › FBA-I-27 a teammate cannot delete a colleague’s
  private saved view. Product bug: `deletePostViewFn` checks only post.edit and
  `deleteView` (`apps/web/src/lib/server/domains/post-views/post-views.service.ts:76`)
  updates by id with no owner or shared check, so any post.edit holder deletes
  a private view they cannot even list (or anyone's shared view). Fix: pass the
  caller and add `created_by_principal_id = caller OR (is_shared AND caller is
admin)` to the update; refuse when no row matched. owner: unassigned, review
  by: 2026-12-03.

### Product suite: feedback admin (merge, moderation and settings)

- `feedback/admin-merge.spec.ts` › FBA-M-11 accepting a merge suggestion
  needs post.merge, like merging by hand. Product bug: `acceptSuggestionFn`
  gates on `suggestion.manage` only (`apps/web/src/lib/server/functions/feedback.ts:33`)
  and calls `mergePost` (`merge-suggestion.service.ts:128`), so a role that
  holds suggestion.manage but not post.merge merges posts (mergePostFn refuses
  the same role). Fix: also require `PERMISSIONS.POST_MERGE` in
  `acceptSuggestionFn`. owner: unassigned, review by: 2026-12-03.
- `src/lib/server/domains/posts/__tests__/post-merge.db.test.ts` (vitest,
  `it.skip`) › FBA-M-12 a manual merge resolves the pending suggestions that
  name the merged post. Product bug: `mergePost`
  (`apps/web/src/lib/server/domains/posts/post.merge.ts:66`) never touches
  `post_merge_suggestions`; only `acceptMergeSuggestion` dismisses siblings
  (`merge-suggestion.service.ts:141`), so after a manual merge a suggestion
  naming the merged post stays pending (Similar posts card, inbox badge)
  until the 30-day expiry, and accepting it fails with ALREADY_MERGED. Fix:
  dismiss pending suggestions naming the duplicate inside `mergePost` (and on
  delete/reject). owner: unassigned, review by: 2026-12-03.
- `feedback/admin-moderation.spec.ts` › FBA-Q-04 a test customer held post is
  left out of the queue, as it is of the counts. Product bug: the sidebar
  badge, banner and filter-pane count exclude test customers
  (`apps/web/src/lib/server/functions/moderation.ts:133`, `notTestPrincipal`)
  but `listPendingPosts` / `listPendingComments`
  (`apps/web/src/lib/server/domains/moderation/moderation.service.ts:126`) do
  not, so the queue lists items the count leaves out. Fix: add
  `notTestPrincipal(posts.principalId)` (and the comment author's) to both
  list queries. owner: unassigned, review by: 2026-12-03.
- `feedback/admin-statuses-settings.spec.ts` › FBA-T-21 a status can be
  created again with the slug of a deleted one. `createStatus` looks the slug
  up among every row, soft-deleted ones included
  (`apps/web/src/lib/server/domains/statuses/status.service.ts:68`), so a
  deleted status blocks its slug for ever with `DUPLICATE_SLUG` for a status
  no page lists. Fix: add `isNull(postStatuses.deletedAt)` to that lookup.
  owner: unassigned, review by: 2026-12-03.
- `feedback/admin-statuses-settings.spec.ts` › FBA-T-25 marking another
  status default leaves exactly one default (`@isolated`). `updateStatus`
  with only `{ isDefault: true }` runs `setStatusAsDefaultAtomic`, then an
  UPDATE whose SET is empty
  (`apps/web/src/lib/server/domains/statuses/status.service.ts:139-149`);
  drizzle refuses it ("No values to set"), so the call answers 500 after the
  default already moved. Fix: skip the second UPDATE when `updateData` is
  empty and return the re-read row. owner: unassigned, review by: 2026-12-03.
- `feedback/admin-statuses-settings.spec.ts` › FBA-T-25 the only default
  status cannot be unset (`@isolated`). `updateStatus { isDefault: false }`
  on the default writes `is_default = false`
  (`apps/web/src/lib/server/domains/statuses/status.service.ts:142`), leaving
  no default (`getDefaultStatus()` null). Fix: refuse unsetting the default
  (`CANNOT_UNSET_DEFAULT`); a default only moves by marking another one.
  owner: unassigned, review by: 2026-12-03.
- `feedback/admin-tags-settings.spec.ts` › FBA-T-31 a tag can be created
  with the name of a deleted tag. The duplicate-name check spans
  soft-deleted tags (`apps/web/src/lib/server/domains/post-tags/post-tag.service.ts:53`),
  so the name of a deleted tag can never be reused and the error names a tag
  no page lists. Fix: add `isNull(postTags.deletedAt)` to the lookup (and to
  the same check in `updatePostTag`). owner: unassigned, review by:
  2026-12-03.
- `feedback/admin-tags-settings.spec.ts` › FBA-T-32 a deleted tag no longer
  shows on the posts it was on. `deletePostTag` only sets `deleted_at`
  (`apps/web/src/lib/server/domains/post-tags/post-tag.service.ts:148`);
  `post_tag_assignments` stay and the inbox and post queries load tags with
  no `deleted_at` filter (`apps/web/src/lib/server/domains/posts/post.inbox.ts:326`,
  `post.query.ts:105`), so the chip stays, while the confirm says the tag is
  removed from all posts. Fix: delete the tag's assignments in the same
  transaction (or filter deleted tags wherever post tags are read). owner:
  unassigned, review by: 2026-12-03.

### Product suite: feedback admin (AI, notifications, import and export)

- `feedback/admin-import-export.spec.ts` › import route › FBA-X-12 a re-import
  with blank status and vote_count cells keeps the stored status and votes.
  Product bug: a `source_id` update writes whatever the row says, so a blank
  `status` resets the post to the default status and a blank `vote_count`
  sets it to 0 although votes may exist (`processBatch` update loop,
  `apps/web/src/lib/server/domains/import/import-service.ts:369`; the row
  schema turns a blank `vote_count` into 0 at `import-row-resolver.ts:58`).
  Fix: on the update path keep the stored `statusId`/`voteCount` when the
  cell is blank. owner: unassigned, review by: 2026-12-03.
- `feedback/admin-import-export.spec.ts` › import route › FBA-X-19 rows naming
  a deleted board, status or tag get fresh live ones. Product bug:
  `loadRowContext` reads `postStatuses`, `postTags` and `boards` with no
  `deleted_at` filter
  (`apps/web/src/lib/server/domains/import/import-row-resolver.ts:139`,
  `:148`, `:153`), so the post lands on a hidden board with a deleted status
  and tag. Fix: filter `isNull(deletedAt)` in the three lookups (and in
  `ensureBatchTag`). owner: unassigned, review by: 2026-12-03.
- `feedback/admin-import-export.spec.ts` › board export › FBA-X-02 a deleted
  board cannot be exported by id. Product bug: `/api/export` checks the board
  with `getBoardById`, which has no `deleted_at` filter
  (`apps/web/src/routes/api/export.ts:49`,
  `apps/web/src/lib/server/domains/boards/board.service.ts:321`), and the
  no-board branch of `listPostsForExport` lists every board
  (`apps/web/src/lib/server/domains/posts/post.export.ts:23`), so a deleted
  board's posts download. Fix: refuse a deleted board with `Board not found`
  and filter `deleted_at` in the all-boards list. owner: unassigned, review
  by: 2026-12-03.
- `feedback/admin-notifications.spec.ts` › FBA-N-15 the unread badge leaves out
  bells redacted because the post was deleted. Product bug: once a post is
  deleted, `getNotificationsForMember` redacts its bells (`Notification` /
  `This activity is no longer visible to you.`), but `getUnreadCount`
  (`apps/web/src/lib/server/domains/notifications/notification.service.ts:243`)
  counts every unread, unarchived row with no post visibility check, so the
  badge shows an unread count made of rows the person cannot open. Fix: apply
  the same post/board/moderation join (or the list's denial rule) in
  `getUnreadCount`, or exclude rows whose post is deleted or no longer visible.
  owner: unassigned, review by: 2026-12-03.
- `feedback/admin-ai.spec.ts` › FBA-AI-08 the summary input leaves out private
  team notes. Product bug: `generateAndSavePostSummary` selects every
  non-deleted comment, private notes included, into the model input
  (`apps/web/src/lib/server/domains/summary/summary.service.ts:149`), so
  quotes from an internal note can surface in `keyQuotes`, which REST and MCP
  return as `summaryJson`. Fix: add `eq(postComments.isPrivate, false)` (and
  skip held comments) to that query. owner: unassigned, review by:
  2026-12-03.

### Product suite: changelog
