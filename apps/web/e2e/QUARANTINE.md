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
- `status/public-page.spec.ts` › STA-P-15 uptime follows a status that has no
  history row. `createStatusComponent`
  (`apps/web/src/lib/server/domains/status/status.components.ts:176`) stores a
  non-operational initial status (REST and the server fn accept one) without a
  `status_component_events` row or a `status.component_changed` event, and the
  uptime derivation starts from operational when a service has no event
  (`status.public.ts:291`), so a service created "Major outage" shows a 100%
  operational bar. Fix: write the initial event (and the webhook event) when the
  create status is not operational. owner: unassigned, review by: 2026-12-03.
- `status/subscribe.spec.ts` › STA-S-09 a component subscription with no or
  unknown services is refused. `subscribeStatusFn`
  (`apps/web/src/lib/server/functions/status-subscriptions.ts:25`) takes
  `scope: 'components'` with an empty or non-existent `componentIds` and stores
  an active subscription that can never match an incident (it still counts as
  a subscriber and takes a plan slot). The portal UI prevents both. Fix: refuse
  an empty list and ids that are not live, visible services. owner:
  unassigned, review by: 2026-12-03.
- `status/emails.spec.ts` › STA-S-23 nothing is emailed for an incident or
  window created already over. Same cause as STA-A-30
  (`status.service.ts:242`, `:317`): subscribers get "New incident reported …
  Resolved". owner: unassigned, review by: 2026-12-03.
- `status/emails.spec.ts` › STA-S-30 an incident cannot be pinned to the
  "maintenance" impact. The REST validator
  (`apps/web/src/routes/api/v1/status/-validation.ts:33`) and the server fn
  accept `impact: 'maintenance'` on `kind: 'incident'`, and the incident email
  (`packages/email/src/templates/status-incident-published.tsx:29`) has no
  colour or label for it, so its impact bar reads " · Investigating". Fix:
  refuse it for incidents (or give the template a Maintenance label). owner:
  unassigned, review by: 2026-12-03.

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
- `feedback/portal-feed.spec.ts` › FBP-L-24 the author's held post shows its
  pending panel on the first server-rendered feed page (FBP-B03).
  `fetchPortalData` maps the first feed page field by field and leaves out
  `moderationState` (and `pinnedAt`)
  (`apps/web/src/lib/server/functions/portal.ts:257-270`), while later pages
  spread the whole row (`public-posts.ts:170-176`). The card reads
  `post.moderationState` (`feedback-container.tsx:650`), so the author's own
  held post has no "Pending review" panel until the feed refetches. Smallest
  fix: add `moderationState: post.moderationState` (and `pinnedAt`) to that
  map. owner: unassigned, review by: 2026-12-03.
- `feedback/portal-feed.spec.ts` › FBP-L-15 a hand-edited bad minVotes or
  dateFrom is ignored like a bad sort (FBP-B02). `?minVotes=abc` answers HTTP
  500 (red run: expected 200, received 500): the route's search schema gives
  `minVotes` and `dateFrom` no `.catch`
  (`apps/web/src/routes/_portal/index.tsx:32-37`) while `sort` and `view` have
  one. Smallest fix: `.optional().catch(undefined)` on both. owner:
  unassigned, review by: 2026-12-03.
- `feedback/portal-submit.spec.ts` › FBP-S-22 an anonymous session cannot
  upload while anonymous posting is off (FBP-B13). `handlePortalUpload`
  (`apps/web/src/routes/api/portal/upload.ts:8-37`) accepts any session with
  a principal; it never reads the workspace anonymous switch (red run:
  expected 403, received 200). Smallest fix: for an anonymous principal,
  refuse with 403 unless `workspaceAllowsAnonymous(settings.portalConfig)`.
  owner: unassigned, review by: 2026-12-03.
- `feedback/portal-submit.spec.ts` › FBP-S-24 public post metadata is bounded
  (FBP-B14). `createPublicPostSchema.metadata` is
  `z.record(z.string(), z.string())` with no bound
  (`apps/web/src/lib/shared/schemas/posts.ts:140`); 2,000 keys of 200
  characters are stored as `widget_metadata`. Smallest fix: cap the key count
  (e.g. 50), key length (100) and value length (1,000) in the schema. owner:
  unassigned, review by: 2026-12-03.
- `feedback/portal-submit.spec.ts` › FBP-S-06 an anonymous comment is refused
  with the same code as an anonymous post or vote (FBP-B04). Comments throw
  `ANONYMOUS_NOT_ENABLED` (`apps/web/src/lib/server/functions/comments.ts:84`)
  where posts and votes throw `ANONYMOUS_NOT_ALLOWED`
  (`public-posts.ts:373`, `:449`) for the same workspace switch. Smallest fix:
  use `ANONYMOUS_NOT_ALLOWED` in comments.ts. Runs in product-isolated.
  owner: unassigned, review by: 2026-12-03.
- `feedback/portal-submit.spec.ts` › FBP-S-07 the anonymous post cap answers
  as a rate limit, and the composer says so (FBP-B04). `RATE_LIMITED` is
  thrown as a `ValidationError` (status 400)
  (`apps/web/src/lib/server/functions/public-posts.ts:379`, `:454`), and the
  composer replaces every refusal with "Could not submit your feedback. Please
  try again." (`feedback-header-animated.tsx:300-308`), wrong advice inside
  the hour. Smallest fix: throw the app's rate-limit error (429) and map it to
  a "too many posts, try again later" line in the composer. Runs in
  product-isolated. owner: unassigned, review by: 2026-12-03.
- `feedback/portal-post-detail.spec.ts` › FBP-L-31 a pinned comment outside
  the first page still shows on the page (new). The detail query returns
  `pinnedComment` whatever the paging
  (`apps/web/src/lib/server/domains/posts/post.public.detail.ts:475-510`), but
  the portal route (`apps/web/src/routes/_portal.b.$slug.posts.$postId.tsx:396`)
  passes only `pinnedCommentId` to the thread, which floats the pinned
  comment only if it is among the loaded 30 roots
  (`apps/web/src/components/public/comment-thread.tsx:218`);
  `PinnedCommentSection` is used only by the admin modal. An older pinned
  answer is invisible until "Show more". Smallest fix: render
  `PinnedCommentSection` (or prepend `pinnedComment`) on the portal page when
  the pinned comment is not in the loaded page. owner: unassigned, review by:
  2026-12-03.
- `feedback/portal-author-actions.spec.ts` › FBP-S-17 the author edit of an
  unvoted, uncommented post succeeds instead of erroring (new). With default
  settings, every author edit that passes the earlier checks reaches
  `hasCommentsFromOthers`, which compares `post_comments.principal_id` to the
  principal TypeID inside a raw `sql` template
  (`apps/web/src/lib/server/domains/posts/post.user-actions.ts:77-83`, and the
  same copy in `post.permissions.ts:303-309`); the TypeID is not converted to
  a uuid, Postgres answers `invalid input syntax for type uuid`, and the
  customer gets "Something went wrong on our side" (HTTP 500). So a customer
  can never edit their own post by default. Smallest fix: use
  `ne(postComments.principalId, authorPrincipalId)` in both copies. owner:
  unassigned, review by: 2026-12-03.

### Product suite: FBP comments and notifications

- `feedback/portal-comments.spec.ts` › FBP-C-03 with the anonymous switch off,
  an anonymous comment is refused with the code votes and posts use
  (FBP-B04). The comment gate throws `ANONYMOUS_NOT_ENABLED`
  (`apps/web/src/lib/server/functions/comments.ts:84`) where votes and posts
  throw `ANONYMOUS_NOT_ALLOWED` for the same rule
  (`apps/web/src/lib/server/functions/public-posts.ts`, toggleVote and
  createPublicPost). Smallest fix: use `ANONYMOUS_NOT_ALLOWED` in
  comments.ts. Runs in product-isolated. owner: unassigned, review by:
  2026-12-03.
- `feedback/portal-comments.spec.ts` › FBP-C-11 after a teammate replies, the
  author is no longer offered Edit or Delete (FBP-B17). The server refuses both
  (`getCommentPermissionsFn` answers `{canEdit:false, canDelete:false}`), but
  the thread decides from authorship alone
  (`apps/web/src/components/public/comment-thread.tsx:435-437`) and never
  calls `useCommentPermissions`, so the buttons show and fail after Save or
  the confirm dialog. Smallest fix: gate the buttons on
  `useCommentPermissions(comment.id)` for non-team viewers. owner:
  unassigned, review by: 2026-12-03.
- `feedback/portal-comment-extras.spec.ts` › FBP-C-15 a customer the board
  refuses comments cannot react either, nor on a read-only board; and (in
  product-isolated) with anonymous interaction off, an anonymous session
  cannot react (FBP-B18). `runAddReaction`
  (`apps/web/src/lib/server/functions/comments.ts:128-145`) and `addReaction`
  (`apps/web/src/lib/server/domains/comments/comment.reactions.ts:54`) check
  only that the comment is viewable: no comment tier, no read-only board, no
  workspace anonymous ceiling, no lock. Smallest fix: run the same
  `canCreateComment` decision (minus moderation) and the anonymous ceiling
  before inserting a reaction. owner: unassigned, review by: 2026-12-03.
- `feedback/portal-comment-extras.spec.ts` › FBP-C-19 a customer cannot make the
  system notify someone by crafting a mention in a post (FBP-B22). The
  sanitiser keeps `mention` nodes from any author
  (`apps/web/src/lib/server/sanitize-tiptap.ts:245`) and
  `syncPostMentions` (`apps/web/src/lib/server/domains/posts/sync-post-mentions.ts:34`)
  notifies any user, member or admin principal who can view the post, so a
  customer's crafted contentJson bells and emails the admin
  ("<name> mentioned you in ..."). The portal editor has no mention picker.
  Smallest fix: strip mention nodes from non-team authors in
  `runCreatePublicPost` (or skip mention sync when the author is not team).
  owner: unassigned, review by: 2026-12-03.
- `feedback/portal-emails.spec.ts` › FBP-N-17 a link that was never issued is
  not called expired (FBP-B24). `getValidUnsubscribeToken` collapses unknown,
  used and expired tokens to null
  (`apps/web/src/lib/server/domains/subscriptions/subscription.service.ts:549-575`)
  and the page shows "This link has expired / It was already used or is too
  old" for all three. The test asserts only that a never-issued token is not
  called expired. Smallest fix: return the reason (unknown, used, expired) and
  show "This link is not valid" for an unknown token. owner: unassigned,
  review by: 2026-12-03.
- `feedback/portal-emails.spec.ts` › FBP-N-19 the mention email does not label
  an unsubscribe-all link as "Unsubscribe from this post" (FBP-B20). The
  mention email's token is `unsubscribe_all`
  (`apps/web/src/lib/server/events/targets.ts:693`) and the page it opens asks
  "Turn off all email?", but the footer keeps the layout's default label
  `Unsubscribe from this post`
  (`packages/email/src/templates/email-layout.tsx:97`). Smallest fix: pass an
  `unsubscribeLabel` such as "Turn off email notifications" from
  `sendPostMentionEmail`. owner: unassigned, review by: 2026-12-03.
- `feedback/portal-emails.spec.ts` › FBP-N-20 the post unsubscribe page does not
  promise that only email stops (FBP-B24). The page says "You will stop
  getting email updates about it" (`apps/web/src/routes/unsubscribe.tsx:243-257`),
  but confirming deletes the whole subscription
  (`apps/web/src/lib/server/domains/subscriptions/subscription.service.ts:103-113`),
  so the in-app bell for the post stops too (the companion test FBP-N-20 pins
  that both stop). Smallest fix: reword to "You will stop getting updates
  about this post." owner: unassigned, review by: 2026-12-03.

### Product suite: FBP access, widget and profile

- `feedback/portal-access.spec.ts` › FBP-A-02 a comment on a post the caller
  cannot see answers not found, like a missing post (new). `createComment`
  loads the post with no view filter, then runs `canCreateComment` and throws
  `403 FORBIDDEN` with the policy reason
  (`apps/web/src/lib/server/domains/comments/comment.service.ts:63-90`), while
  a missing post answers `404 POST_NOT_FOUND`; so a comment attempt confirms
  that a team-only or held post exists (red run: received `FORBIDDEN`). Votes
  already do this right (`assertPostVotable`, `post.access.ts:121-170`).
  Smallest fix: check `canViewPost` first and throw `POST_NOT_FOUND` on a view
  denial, keeping `FORBIDDEN` only for "viewable but not commentable". owner:
  unassigned, review by: 2026-12-03.
- `feedback/portal-profile.spec.ts` › FBP-U-04 a held comment neither lists
  its post nor counts on the public profile (FBP-B30). The "Commented on"
  list and `commentCount` filter `is_private = false` and
  `deleted_at IS NULL` but not `moderation_state`
  (`apps/web/src/lib/server/domains/users/user.public-profile.ts:185-189`,
  `:220-224`), so a comment still waiting for review shows its post on the
  author's public profile (red run: the held comment's post was listed).
  Smallest fix: add `eq(postComments.moderationState, 'published')` to both.
  owner: unassigned, review by: 2026-12-03.
- `feedback/portal-widget.spec.ts` › FBP-W-07 a board with a required custom
  field tells the widget visitor what is missing (FBP-B28). The widget
  composer never sends `customFields`
  (`apps/web/src/components/widget/widget-home-animated.tsx:864-873`);
  `createPost` refuses the required field
  (`apps/web/src/lib/server/domains/posts/post.service.ts:158-166`) and the
  widget shows "Network error. Please try again."
  (`widget-home-animated.tsx:905-915`), so such a board takes no widget posts
  and the visitor is not told why. Smallest fix: render the board's fields in
  the widget composer (the portal's `BoardCustomFields`) and send them; at
  least show the server's validation message. Runs in product-isolated (the
  widget is off on a fresh workspace). owner: unassigned, review by:
  2026-12-03.
- `feedback/portal-widget.spec.ts` › FBP-W-12 the widget counts agree with the
  public profile (FBP-B29). `runGetUserStats`
  (`apps/web/src/lib/server/functions/user.ts:349-371`) counts every post the
  person wrote (held ones too) and every vote (on deleted posts too) (red run:
  ideas 2 and votes 1, expected 1 and 0). Smallest fix: apply the
  `published`, `deleted_at IS NULL` and board-not-deleted filters the public
  profile uses (`user.public-profile.ts`). owner: unassigned, review by:
  2026-12-03.
- `status/api.spec.ts` › STA-X-04 a service created with a non-operational
  status records it. Same cause as STA-P-15 (`status.components.ts:176`): no
  history row and no `status.component_changed` webhook. owner: unassigned,
  review by: 2026-12-03.
- `status/api.spec.ts` › STA-X-06 incident list paging answers bad limits and
  cursors cleanly. `GET /api/v1/status/incidents` parses `limit` with
  `parseInt` itself (`apps/web/src/routes/api/v1/status/incidents/index.ts:64`)
  instead of the shared pagination guard: `limit=0` answers an empty page with
  `hasMore: true` and no cursor, and a negative or non-numeric limit or a
  garbage cursor reaches the database. Fix: use `parsePaginationParams` and
  refuse a cursor that is not a status incident id. owner: unassigned, review
  by: 2026-12-03.
- `status/settings.isolated.spec.ts` › STA-S-08 subscribing honours the page
  gate. `subscribeStatusFn`
  (`apps/web/src/lib/server/functions/status-subscriptions.ts:40`) checks only
  that the caller is not anonymous, so with the page unpublished (or the viewer
  outside the audience) a subscription is stored and takes a plan slot. Fix:
  run `resolveStatusPageGate` first and refuse when it is not available.
  owner: unassigned, review by: 2026-12-03.
- `status/settings.isolated.spec.ts` › STA-S-25 subscribers are not emailed
  while the page is unpublished. The status subscriber fan-out
  (`apps/web/src/lib/server/events/targets.ts:2132`) checks the audience and
  service visibility but never `isStatusPagePublished` or portal privacy, so
  people an admin added before launch get "New incident reported" with a
  "View live status" link that 404s. Fix: return no recipients when the page
  is not published or the portal is private to them. owner: unassigned, review
  by: 2026-12-03.
- `status/settings.isolated.spec.ts` › STA-A-62 clear history keeps the events
  behind statuses still held. `clearStatusHistory`
  (`apps/web/src/lib/server/domains/status/status.service.ts:792`) deletes every
  `status_component_events` row, including those behind statuses an open
  incident still holds, so those services' uptime reads operational while they
  are down. Fix: keep (or re-write) the latest event of each service with a
  live hold. owner: unassigned, review by: 2026-12-03.

### Product suite: platform (INT)

- `platform/getting-started.spec.ts` › INT-ON-03 connecting an integration
  completes its launch task. Product bug: `loadLaunchStatus` looks for a
  connected integration with `integrations.status = 'connected'`
  (`apps/web/src/lib/server/domains/onboarding/launch-status.ts:77`), but
  connections are stored `'active'` or `'paused'` (`saveIntegration`,
  `apps/web/src/lib/server/integrations/save.ts`; `updateIntegrationFn`) and
  the column defaults to `'pending'`, so `hasIntegration` is always false and
  "Connect an integration" never completes. Fix: filter on `'active'`. The
  test passes against a row seeded as `'connected'`. owner: unassigned, review
  by: 2026-12-03.

### Product suite: platform settings, search and analytics (INT)

- `platform/admin-search.spec.ts` › INT-SR-02 the results page ignores a
  short query, an unknown kind and a page out of range. Product bug:
  `validateSearch` in `apps/web/src/routes/admin/search.tsx:23` drops an
  invalid `kind` or `page` by leaving the key out of its result, but the raw
  value still reaches `Route.useSearch()`, so `?kind=nope` presses no chip and
  sends an invalid kind, and `?page=99` or `?page=abc` sit on "Searching…"
  with Previous/Next and no results. Fix: return the keys explicitly
  (`kind: undefined`, `page: undefined`), as `routes/admin/analytics.tsx`
  does for `section`. owner: unassigned, review by: 2026-12-03.

### Product suite: people (segments)

- `people/segments.spec.ts` › dynamic evaluation › PPL-G-06 vote and comment
  count rules match people who voted and commented. Product bug:
  `activityCountSql` counts rows in tables named `votes` and `comments`
  (`apps/web/src/lib/server/domains/segments/segment.evaluation.ts:154`,
  `:156`, `:275`, `:281`), which do not exist (`post_votes`,
  `post_comments`), so every evaluation of a segment with a `vote_count` or
  `comment_count` rule fails with a server error ("relation \"comments\" does
  not exist"). The seeded "Active Users" segment has both rules, so it can
  never be evaluated. Fix: pass `post_votes` and `post_comments`. owner:
  unassigned, review by: 2026-12-03.
- `people/segments.serial.spec.ts` › PPL-G-50 evaluate every dynamic segment
  at once. Product bug: `evaluateAllDynamicSegments` evaluates one segment
  after another with no per-segment catch
  (`apps/web/src/lib/server/domains/segments/segment.evaluation.ts:469`), and
  the seeded "Active Users" segment always fails (the bug above), so
  `evaluateAllSegmentsFn` answers a server error in every seeded workspace
  and later segments are never evaluated. Fix: the table names above; also
  catch per segment and report failures. owner: unassigned, review by:
- `people/segments.spec.ts` › REST segment members › PPL-G-28 removing a
  non-member is not counted as a removal. Product bug: DELETE
  `/api/v1/segments/:slug/members` counts every settled `removeMember` call
  (`apps/web/src/routes/api/v1/segments/$slug.members.ts:153`), including
  people who held no row, so `removed` overstates (and each no-op writes a
  `segment.member.removed` audit row). Fix: have `removeMember` return
  whether a row was deleted and count those. owner: unassigned, review by:
- `people/segments.spec.ts` › REST segment members › PPL-G-30 a body that is
  not JSON is a 400, not a server error. Product bug: `request.json()`
  throws a `SyntaxError` that the route does not map
  (`apps/web/src/routes/api/v1/segments/$slug.members.ts:71`, `:124`), so
  `handleDomainError` answers 500 `INTERNAL_ERROR`. Fix: catch the parse
  error and answer `badRequestResponse('Invalid JSON body')`. owner:
  unassigned, review by: 2026-12-03.
- `people/segments.spec.ts` › segment rules and lifecycle (nightly) ›
  PPL-G-11 a matching member held by another source is not counted as added
  again. Product bug: evaluation diffs only `added_by='dynamic'` rows
  (`apps/web/src/lib/server/domains/segments/segment.evaluation.ts:431`), so
  a matching person whose row is `api` or `widget` is reported in `added` on
  every run though the insert is a no-op. Fix: diff against every row of the
  segment, or count the rows the insert actually wrote (`returning`). owner:
  unassigned, review by: 2026-12-03.
- `people/segments.spec.ts` › segment rules and lifecycle (nightly) ›
  PPL-G-13 a schedule the scheduler cannot parse is refused on save. Product
  bug: `CRON_REGEX` (`apps/web/src/lib/server/functions/admin.ts:1186`)
  accepts patterns such as `99 99 * * *` that `parseCron` rejects; the
  segment saves, the scheduler only logs, and the segment never
  auto-evaluates with no error to the caller. Fix: validate with `parseCron`
  in the zod refinement. owner: unassigned, review by: 2026-12-03.
- `people/segments.spec.ts` › segment rules and lifecycle (nightly) ›
  PPL-G-15 clearing a dynamic segment's rules is refused and keeps its
  members. Product bug: `updateSegment` writes `rules: null` on a dynamic
  segment (`apps/web/src/lib/server/domains/segments/segment.service.ts:217`)
  although create refuses a dynamic segment without rules; the next
  evaluation removes every member (and queues removals for user-sync
  integrations). Fix: in `updateSegment`, refuse `rules` that are null or have
  no conditions when `existing.type === 'dynamic'`. owner: unassigned, review
  by: 2026-12-03.

### Product suite: people (team access and portal account)

- `people/members.spec.ts` › changing roles › PPL-T-35 choosing Member for a
  custom-role holder moves them to the Manager preset. Product bug: the
  change succeeds and is audited, but the workspace assignment keeps the
  custom (or Contributor / Support lead) role, so the badge and the
  permissions do not change. `updateMemberRole` calls `setPrincipalRole` with
  no `assignRoleId` and no `resetAssignment`
  (`apps/web/src/lib/server/domains/principals/principal.service.ts:400`), and
  the factory reconciles the assignment only when the legacy column moves
  (`apps/web/src/lib/server/domains/principals/principal.factory.ts:381`);
  member to member never moves. Fix: pass `resetAssignment: true` when the
  caller chose `member` with no `roleId`. owner: unassigned, review by:
  2026-12-03.
- `people/members.spec.ts` › REST role changes and removal › PPL-T-48 a
  personal key cannot change or remove its own creator. Product bug: the REST
  self guards compare the target with the key's own service principal
  (`auth.principalId`), not the person the key acts for
  (`apps/web/src/routes/api/v1/principals/$principalId.ts:98` and `:151`), so
  `CANNOT_MODIFY_SELF` / `CANNOT_REMOVE_SELF` never fire and an owner's
  personal key demotes (or removes) the owner; the server functions refuse
  the same action (PPL-T-37). Fix: pass the key's creator principal as the
  acting principal for personal keys. owner: unassigned, review by:
  2026-12-03.
- `people/portal-account.spec.ts` › profile › PPL-ACC-14 saving someone
  else's uploaded avatar key is refused. Product bug: `saveAvatarKeyFn` only
  checks that the key starts with `avatars/` and has no `..`
  (`apps/web/src/lib/server/functions/user.ts:44`), so any signed-in person
  can point their avatar at another person's object, and a later
  `removeAvatarFn` (`user.ts:222`, via `deleteExistingAvatar`) deletes that
  object from storage. Fix: issue avatar keys per user (for example
  `avatars/<userId>/...` from `getAvatarUploadUrlFn`) and refuse a key outside
  the caller's prefix. owner: unassigned, review by: 2026-12-03.

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
- `people/auth-portal.spec.ts` › PPL-AUTH-16 with the magic-link method off,
  portal-signin mails no working link. Product bug A-B2: `requestEmailSignin`
  (`apps/web/src/lib/server/auth/email-signin.ts:51`) and the route
  (`apps/web/src/routes/api/auth/portal-signin.ts:130`) never read
  `authConfig.oauth.magicLink`, and `/magic-link/verify` is never method-gated,
  so with the method off (the default) the endpoint still mails a link and code
  that sign anyone in. The settings row is called "Email magic link"; off means
  the method is not offered. Fix: refuse (or silently skip) the send when the
  method is off, keeping the uniform answer. Note: every other test that uses
  `/api/auth/portal-signin` on the default settings passes only because of this
  bug; once fixed, the suite baseline must turn the method on. owner:
  unassigned, review by: 2026-12-03.
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
- `people/auth-methods.spec.ts` › PPL-AUTH-32 password method off refuses a
  password sign-up. Product bug A-B3: the Layer B method gate returns early
  when no principal exists (`apps/web/src/lib/server/auth/hooks.ts:415`), so
  `/sign-up/email` creates a password account and a session while "Password"
  is off. Fix: apply the password toggle to `/sign-up/email` before the
  principal lookup. Runs in product-isolated. owner: unassigned, review by:
  2026-12-03.
- `people/auth-methods.spec.ts` › PPL-AUTH-151 required two-factor gives an
  un-enrolled password sign-in no usable session. Product bug: "Require
  two-factor authentication" ("Users must enter a code from their
  authenticator app after their password.",
  `apps/web/src/components/admin/settings/security/sign-in-providers-tab.tsx:249`)
  is enforced only by the dialog
  (`apps/web/src/components/auth/portal-auth-form-inline.tsx:501`); nothing on
  the server reads `authConfig.twoFactor.required`, so a direct
  `/api/auth/sign-in/email` returns a working session. Fix: in the sign-in
  after-hook, when required and the user is not enrolled, issue only an
  enrolment-scoped session (or refuse). Runs in product-isolated. owner:
  unassigned, review by: 2026-12-03.
- `people/auth-security.spec.ts` › PPL-AUTH-145 a removed admin cannot use
  their recovery codes. Product bug: recovery codes (the admins' break-glass
  for single sign-on) are only deleted with the user row; removing or demoting
  a teammate sets `principal.role = 'user'` and leaves them working
  (`apps/web/src/lib/server/auth/recovery-codes-status.ts:8`,
  `apps/web/src/lib/server/functions/recovery-codes-consume.ts:126`), so the
  code still signs the person in past "Require SSO" and still satisfies the
  workspace break-glass check. Fix: refuse codes whose holder no longer has
  auth.manage at consume time, and delete them on removal or demotion
  (emitting the declared `sso.recovery_codes.invalidated`). owner:
  unassigned, review by: 2026-12-03.
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

- `changelog/publish-notifications.spec.ts` › CHG-S-11 the publisher is not
  notified of their own announcement. Product bug: `createChangelog` and
  `updateChangelog` build the event actor with
  `buildEventActor({ principalId })` and no `userId`
  (`apps/web/src/lib/server/domains/changelog/changelog.service.ts:147`), which
  makes it a `service` actor (`apps/web/src/lib/server/events/dispatch.ts:70`).
  `isActorSubscriber` returns false for every service actor
  (`apps/web/src/lib/server/events/targets.ts:391`), so a publisher who is
  subscribed gets their own email and bell. Fix: pass the author's `userId`
  (and email) to `buildEventActor`, or match `principalId` before the
  service-actor early return. owner: unassigned, review by: 2026-12-03.
- `changelog/publish-notifications.spec.ts` › CHG-S-14 the email "View Update"
  button links to the entry itself. Product bug: `getChangelogSubscriberTargets`
  builds `changelogUrl` as `sectionUrl('changelog', '/changelog')`
  (`apps/web/src/lib/server/events/targets.ts:2044`), so the button opens the
  index, not `/changelog/<id>` (the entry id is in the event). Fix: use
  `/changelog/${event.data.changelog.id}` for the email and Slack link. owner:
  unassigned, review by: 2026-12-03.
- `changelog/publish-notifications.spec.ts` › CHG-S-28 an entry with a
  segment-gated label is not announced to subscribers outside the segment.
  Product bug: `getChangelogSubscriberTargets`
  (`apps/web/src/lib/server/events/targets.ts:1916`) ignores the label
  segment gate, so subscribers outside the segment get the full body of a
  gated entry by email and bell. Fix: intersect the fan-out with the members
  of the entry's gated labels' segments, as the public reads do. owner:
  unassigned, review by: 2026-12-03.
- `changelog/admin-settings.spec.ts` › CHG-A-49 renaming a label keeps its
  id, and a rename onto a taken name is refused. Product bug (new): every
  label rename fails with a database error ("Failed to save label. Something
  went wrong on our side."). The duplicate-name check in
  `updateChangelogCategory`
  (`apps/web/src/lib/server/domains/changelog/changelog-category.service.ts:101`)
  puts the TypeID straight into a raw `sql` template (`id != ${id}`), so
  Postgres gets `changelog_category_...` for a uuid column ("invalid input
  syntax for type uuid"). Fix: `and(sql\`lower(name) = lower(${name})\`,
  ne(changelogCategories.id, id))` so the column codec converts the id.
  owner: unassigned, review by: 2026-12-03.
- `changelog/admin-settings.spec.ts` › CHG-A-52 a signed-out caller cannot read
  gated labels or their segment ids. Product bug: `listChangelogCategoriesFn`
  (`apps/web/src/lib/server/functions/changelog-categories.ts:45`) has no
  auth, portal-access or gate check and returns every label with its
  `segmentIds`. Fix: filter gated labels by the viewer (team sees all) and drop
  `segmentIds` for non-team callers. owner: unassigned, review by: 2026-12-03.
- `changelog/feed.spec.ts` › CHG-F-05 item descriptions are plain text, not
  markdown syntax. Product bug: `routes/changelog/feed.ts:146` runs `stripHtml`
  over the markdown projection (`entry.content`), so `**`, `##` and `[x](y)`
  reach feed readers. Fix: render plain text from `contentJson` (or strip
  markdown) before truncating. owner: unassigned, review by: 2026-12-03.
- `changelog/portal-changelog.spec.ts` › CHG-P-14 with the Changelog product off
  its public server functions answer nothing (`@isolated`). Product bug:
  `listPublicChangelogsFn` and `getPublicChangelogFn`
  (`apps/web/src/lib/server/functions/changelog.ts:226`, `:272`) skip the
  product flag that the routes, feed and widget honour. Fix: return the empty
  list / not found when `changelog` is off. owner: unassigned, review by:
  2026-12-03.
- `changelog/portal-changelog.spec.ts` › CHG-P-17 the sitemap leaves out entries
  a crawler cannot read. Product bug: `apps/web/src/routes/sitemap[.]xml.ts:73`
  lists every published entry without the label segment gate (or the
  audience), so gated entry URLs reach crawlers. Fix: apply
  `categoryGateCondition` for an anonymous actor and skip entries when the
  audience is signed-in only. owner: unassigned, review by: 2026-12-03.
- `changelog/admin-authoring.spec.ts` › CHG-A-16 deleting an entry: confirm
  copy that matches a soft delete, then gone from admin and portal. Product bug:
  the confirm dialog says "This action cannot be undone. The changelog entry
  will be permanently deleted."
  (`apps/web/src/components/admin/changelog/changelog-list.tsx:335`), but
  `deleteChangelog` only sets `deletedAt`; the row, its links and its view
  count stay. Fix: reword the copy (for example "The entry is removed from
  your changelog and feed.") or make the delete real. owner: unassigned,
  review by: 2026-12-03.
- Vitest `it.fails` (fails today, passes once fixed, then flip it to `it`), all
  under `apps/web/src/lib/server/domains/changelog/__tests__/`:
  - `changelog-display-date.test.ts` › CHG-A-19 clears a stale display date on
    a draft entry with null. `validateDisplayDate` also runs for `null`
    (`changelog.service.ts:617`, called at `:221`), so clearing the override on
    a draft or scheduled entry throws "Display date can only be set on
    published changelog entries". Fix: skip the check when `displayDate` is
    null.
  - `changelog-linked-posts.test.ts` › CHG-A-23 a duplicate post id on create
    or update is saved once. `createChangelog`/`updateChangelog` do not
    de-duplicate `linkedPostIds` and do not wrap entry, links and labels in a
    transaction (`changelog.service.ts:569`), so a duplicate violates the
    unique index after the old links were already deleted. Fix: de-duplicate
    the ids and run the writes in one transaction.
  - `changelog-update-validation.test.ts` › CHG-A-33 update refuses an empty
    body like create does. `updateChangelog` validates only the title
    (`changelog.service.ts:195`), so the editor can blank a published entry.
    Fix: apply create's content check when `content` or `contentJson` is
    sent.
  - `changelog-category-gate.test.ts` › CHG-P-05 a fully gated page is not
    returned empty with more to load. `listPublicChangelogs` applies the label
    gate after paging (`changelog.public.ts:301`), so the portal gets empty
    pages with `hasMore: true`. Fix: put `categoryGateCondition` in the paged
    query.
  - `changelog-subscription-import.test.ts` › CHG-S-26 importing someone who
    unsubscribed leaves them unsubscribed. `importChangelogSubscribersFromEmails`
    upserts with `unsubscribedAt = null` (`changelog-subscription.service.ts:115`),
    so a spreadsheet overrides the person's opt-out. Fix: insert with
    `onConflictDoNothing` for the import path.

  owner: unassigned, review by: 2026-12-03.
