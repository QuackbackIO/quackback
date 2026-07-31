# changelog-segment-targeting — round 1 transcript

KIND=capability. DONE WHEN: publishing a changelog entry can target a segment,
and only subscribers in that segment receive the publish email.

## What changed

- `changelog_entries.segment_ids` (jsonb, NOT NULL DEFAULT `[]`) — migration
  `packages/db/drizzle/0248_changelog_entry_segments.sql` + journal entry.
  Same "segment list, [] = everyone" convention as the batch-5 article gate.
- `createChangelogSchema` / `updateChangelogSchema` accept `segmentIds`;
  `createChangelogFn` / `updateChangelogFn` pass them through;
  `createChangelog` / `updateChangelog` persist them (undefined = untouched,
  provided list replaces wholesale); `getChangelogById` / `listChangelogs`
  return them.
- `getChangelogSubscriberTargets` (events/targets.ts): after building the
  subscriber union (dedicated `changelog_subscriptions` + legacy linked-post
  subscribers), a non-empty `segmentIds` on the entry restricts the whole
  fan-out (email AND in-app) to principals holding a `user_segments` row for
  at least one targeted segment. Empty list = broadcast, unchanged behavior.

## Test (red → green)

`apps/web/src/lib/server/events/__tests__/changelog-segment-targets.db.test.ts`
— execution-level, runs the real `getChangelogSubscriberTargets` against the
real DB (`quackback_test`), with peripheral services (settings, sending
address, unsubscribe tokens, notification prefs) mocked. Red first: the two
segment cases failed while the broadcast case passed; green after the filter
landed.

### Input

- Segment `SEG_TARGET` with one member (principal P_MEMBER, user
  `seg-member-<run>@example.com`); segment `SEG_EMPTY` with no members.
- Both P_MEMBER and P_OUTSIDER subscribed in `changelog_subscriptions`.
- Three published entries: open (`segment_ids = []`), gated
  (`segment_ids = [SEG_TARGET]`), empty-segment (`segment_ids = [SEG_EMPTY]`).
- For each, resolve `getChangelogSubscriberTargets(changelog.published, ctx)`.

### Output

- Open entry → email targets: member + outsider; notification principalIds:
  both. (Broadcast unchanged.)
- Gated entry → email targets: member only; outsider excluded from both email
  and in-app targets.
- Empty-segment entry (edge case) → zero email targets, zero notification
  recipients: targeting a segment with no members sends nothing.

### Verification

- New test: 3/3 pass (was 1 pass / 2 fail before the filter).
- `bunx vitest run src/lib/server/events src/lib/server/domains/changelog`:
  55 files, 461 tests, all pass.
- `bun run typecheck`: clean. `bunx eslint` on all touched files: clean.

## Deviation from DONE WHEN

None for the capability itself. Note: the admin composer UI has no segment
picker yet — targeting is settable through the validated server-function
input (`segmentIds` on create/update), which is the publish pipeline the
DONE WHEN is scoped to.
