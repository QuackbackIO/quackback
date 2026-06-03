ALTER TABLE "boards" ADD COLUMN "access" jsonb DEFAULT '{"view":"anonymous","comment":"anonymous","submit":"anonymous","segmentIds":[],"approval":{"posts":false,"comments":false}}'::jsonb NOT NULL;
--> statement-breakpoint
-- ELSE 'anonymous' on every CASE is fail-safe: an unexpected audience.kind
-- would otherwise yield NULL and trip the NOT NULL constraint on the new
-- access column, halting the migration. 'anonymous' matches the column's
-- own default (DEFAULT_BOARD_ACCESS) so the row stays consistent.
UPDATE "boards" SET "access" = jsonb_build_object(
  'view',
    CASE audience->>'kind'
      WHEN 'public'        THEN 'anonymous'
      WHEN 'authenticated' THEN 'authenticated'
      WHEN 'team'          THEN 'team'
      WHEN 'segments'      THEN 'segments'
      ELSE 'anonymous'
    END,
  'comment',
    CASE audience->>'kind'
      WHEN 'public'        THEN 'anonymous'
      WHEN 'authenticated' THEN 'authenticated'
      WHEN 'team'          THEN 'team'
      WHEN 'segments'      THEN 'segments'
      ELSE 'anonymous'
    END,
  'submit',
    CASE audience->>'kind'
      WHEN 'public'        THEN 'anonymous'
      WHEN 'authenticated' THEN 'authenticated'
      WHEN 'team'          THEN 'team'
      WHEN 'segments'      THEN 'segments'
      ELSE 'anonymous'
    END,
  -- Defensive: only copy segmentIds when it is actually a JSON array.
  -- Malformed legacy rows (object, string, number, etc.) fall back to []
  -- so downstream string[] consumers can't trip on bad shapes.
  'segmentIds',
    CASE
      WHEN jsonb_typeof(audience->'segmentIds') = 'array' THEN audience->'segmentIds'
      ELSE '[]'::jsonb
    END,
  'approval',
    '{"posts":false,"comments":false}'::jsonb
);
