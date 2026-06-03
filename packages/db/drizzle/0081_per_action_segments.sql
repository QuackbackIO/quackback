-- Reshape `access.segmentIds` (single shared list) into `access.segments`
-- (per-action lists: view / comment / submit). Existing rows preserve
-- behaviour by copying the old shared list into all three action slots —
-- a board that previously allowed segments_alpha to see / comment / submit
-- continues to allow exactly that. New boards default to empty arrays in
-- all three slots (the column DEFAULT is updated separately by Drizzle's
-- schema sync from DEFAULT_BOARD_ACCESS).
--
-- The `jsonb_typeof(... = 'array')` guard mirrors migration 0079's defensive
-- shape check: a malformed legacy row (object/string/number where an array
-- was expected) falls back to [] so downstream string[] consumers can't
-- trip on bad shapes.
UPDATE "boards" SET "access" = jsonb_set(
  "access" - 'segmentIds',
  '{segments}',
  jsonb_build_object(
    'view',
      CASE
        WHEN jsonb_typeof("access"->'segmentIds') = 'array' THEN "access"->'segmentIds'
        ELSE '[]'::jsonb
      END,
    'comment',
      CASE
        WHEN jsonb_typeof("access"->'segmentIds') = 'array' THEN "access"->'segmentIds'
        ELSE '[]'::jsonb
      END,
    'submit',
      CASE
        WHEN jsonb_typeof("access"->'segmentIds') = 'array' THEN "access"->'segmentIds'
        ELSE '[]'::jsonb
      END
  )
);
--> statement-breakpoint
-- Refresh the column default so newly inserted rows without an explicit
-- `access` value land with the per-action shape (matches DEFAULT_BOARD_ACCESS).
ALTER TABLE "boards" ALTER COLUMN "access" SET DEFAULT '{"view":"anonymous","comment":"anonymous","submit":"anonymous","segments":{"view":[],"comment":[],"submit":[]},"approval":{"posts":false,"comments":false}}'::jsonb;
