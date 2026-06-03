-- Replace the legacy `approval` booleans on boards.access with a tri-state
-- `moderation` object covering the three axes from the design's Moderation
-- tab: anonymous posts, signed-in posts, and comments. Each rule is one of
-- 'inherit' | 'on' | 'off' — `inherit` resolves against the workspace-level
-- portalConfig.moderationDefault.requireApproval at policy-evaluation time
-- (see resolveModerationRule in policy/posts.ts).
--
-- Backfill rules (preserve current behaviour):
--   - approval.posts=true     → anonPosts='on', signedPosts='on'
--   - approval.posts=false    → both 'inherit' (workspace decides)
--   - approval.comments=true  → comments='on'
--   - approval.comments=false → comments='inherit'
--
-- The `(access - 'approval')` strips the legacy field from existing rows so
-- callers don't see contradictory state during the transition window.
UPDATE "boards" SET "access" =
  ("access" - 'approval')
  || jsonb_build_object(
    'moderation', jsonb_build_object(
      'anonPosts',
        CASE WHEN ("access"->'approval'->>'posts')::boolean = true THEN 'on' ELSE 'inherit' END,
      'signedPosts',
        CASE WHEN ("access"->'approval'->>'posts')::boolean = true THEN 'on' ELSE 'inherit' END,
      'comments',
        CASE WHEN ("access"->'approval'->>'comments')::boolean = true THEN 'on' ELSE 'inherit' END
    )
  );
--> statement-breakpoint
-- Refresh the column default so newly inserted rows without an explicit
-- `access` value land with the new `moderation` object and no legacy
-- `approval` field (matches DEFAULT_BOARD_ACCESS).
ALTER TABLE "boards" ALTER COLUMN "access" SET DEFAULT '{"view":"anonymous","vote":"anonymous","comment":"anonymous","submit":"anonymous","segments":{"view":[],"vote":[],"comment":[],"submit":[]},"moderation":{"anonPosts":"inherit","signedPosts":"inherit","comments":"inherit"}}'::jsonb;
