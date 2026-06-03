-- Collapse the three workspace-level anonymous-access toggles
-- (`features.anonymousVoting`, `features.anonymousCommenting`,
-- `features.anonymousPosting`) into a single master switch
-- `features.allowAnonymous`.
--
-- Preserving end-user behaviour requires two passes:
--   1. Bump per-board access tiers: any action whose workspace flag was
--      false AND whose board tier was 'anonymous' is raised to
--      'authenticated'. This way the ceiling that the workspace used to
--      enforce as a kill switch is now reified in the per-board tier,
--      and we can default `allowAnonymous=true` without re-enabling
--      anonymous interaction on boards the admin had locked down via
--      the workspace toggles.
--   2. Rewrite `features`: drop the three legacy keys, set
--      `allowAnonymous=true`. The default is `true` because the per-
--      board bump above has already encoded any prior restrictions.
--
-- Mapping (workspace flag ↔ board action):
--   anonymousVoting     ↔ vote
--   anonymousCommenting ↔ comment
--   anonymousPosting    ↔ submit
--
-- `view` is never restricted at the workspace level today, so its tier
-- is left untouched.
--
-- `settings.portal_config` is stored as `text` (JSON serialised — see
-- migration 0000), so each read casts through `::jsonb` and each write
-- casts back to `::text`. `boards.access` is native `jsonb`.
--
-- FAIL-CLOSED on an unmaterialised config. `portal_config` is a NULLABLE
-- text column, and NULL/empty is a live state (config-file installs,
-- half-onboarded rows, and the dev/test seed all leave it unset). The
-- backfill must NOT key off `portal_config IS NOT NULL`: doing so skips
-- both passes for those tenants, so default-anonymous boards stay open
-- and the runtime resolves `allowAnonymous` to its fail-open default —
-- silently re-opening anonymous comment/submit on upgrade. Instead the
-- flags resolve to the pre-0084 in-app defaults whenever a key (or the
-- whole config, or the whole settings row) is absent:
--   anonymousVoting     -> true  (base default true; read as `?? true`)
--   anonymousCommenting -> false (base default false; deep-merge fallback)
--   anonymousPosting    -> false (base default false; read as `!...` => blocked)
-- Defaulting commenting/posting to `true` here would silently re-open
-- anonymous interaction on upgrade for any tenant whose stored config
-- predates these keys.
WITH settings_row AS (
  -- NULLIF guards an empty-string config from `::jsonb` (which would error).
  SELECT NULLIF(portal_config, '')::jsonb AS pc
  FROM "settings"
  LIMIT 1
),
old_features AS (
  -- No FROM clause → always exactly one row, even when the settings table
  -- is empty or portal_config is NULL/empty. Each scalar subquery returns
  -- NULL in those cases, so COALESCE falls back to the fail-closed default.
  SELECT
    COALESCE((SELECT (pc->'features'->>'anonymousVoting')::boolean FROM settings_row), true) AS allow_vote,
    COALESCE((SELECT (pc->'features'->>'anonymousCommenting')::boolean FROM settings_row), false) AS allow_comment,
    COALESCE((SELECT (pc->'features'->>'anonymousPosting')::boolean FROM settings_row), false) AS allow_submit
)
UPDATE "boards" SET "access" = (
  SELECT
    jsonb_set(
      jsonb_set(
        jsonb_set(
          "boards"."access",
          '{vote}',
          CASE
            WHEN NOT old_features.allow_vote AND "boards"."access"->>'vote' = 'anonymous'
              THEN '"authenticated"'::jsonb
            ELSE "boards"."access"->'vote'
          END
        ),
        '{comment}',
        CASE
          WHEN NOT old_features.allow_comment AND "boards"."access"->>'comment' = 'anonymous'
            THEN '"authenticated"'::jsonb
          ELSE "boards"."access"->'comment'
        END
      ),
      '{submit}',
      CASE
        WHEN NOT old_features.allow_submit AND "boards"."access"->>'submit' = 'anonymous'
          THEN '"authenticated"'::jsonb
        ELSE "boards"."access"->'submit'
      END
    )
  FROM old_features
);
--> statement-breakpoint
-- Step 2: materialise the master switch on the single settings row. Build
-- the features object from COALESCE(config, '{}') so a NULL/empty
-- portal_config is synthesised into a real object rather than left for the
-- runtime fail-open default to decide. Rebuild `features` explicitly —
-- drop the three legacy keys with the `-` operator, then merge
-- `allowAnonymous=true` via `||` — and write it back at the top-level
-- `{features}` path (jsonb_set with create_missing=true creates `features`
-- when absent; it could not create it via a nested `{features,...}` path).
-- This is safe because step 1 has already encoded any prior restriction in
-- the per-board tiers. No-ops when no settings row exists (fresh installs
-- materialise their config with proper defaults during onboarding).
UPDATE "settings"
SET "portal_config" = jsonb_set(
  COALESCE(NULLIF(portal_config, '')::jsonb, '{}'::jsonb),
  '{features}',
  (
    COALESCE(NULLIF(portal_config, '')::jsonb -> 'features', '{}'::jsonb)
      - 'anonymousVoting'
      - 'anonymousCommenting'
      - 'anonymousPosting'
  ) || '{"allowAnonymous": true}'::jsonb,
  true
)::text;
